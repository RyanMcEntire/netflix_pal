import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const allResults = JSON.parse(fs.readFileSync('all_results.json', 'utf8'));

const subtitlesDir = './subtitles';
if (!fs.existsSync(subtitlesDir)) {
  fs.mkdirSync(subtitlesDir);
}

(async () => {
   const browser = await puppeteer.launch({ headless: false });
   const page = await browser.newPage();

   await page.setUserAgent(
     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
   );

   await page.goto('https://www.netflix.com/login', {
     waitUntil: 'networkidle2',
   });

   // waits until manual login
   await page.waitForSelector('[data-uia="profile-link"]', { visible: true });

  const results = [];

  for (const item of allResults) {
    const { nfid, title, vtype } = item;
    const url = `https://www.netflix.com/title/${nfid}`;
    await page.goto(url, { waitUntil: 'networkidle2' });

    const genreTags = await page.evaluate(() => {
      const genreElements = document.querySelectorAll(
        '[data-uia="previewModal--tags-genre"] a'
      );
      return Array.from(genreElements).map((el) => el.textContent.trim());
    });

    let subtitleLink = null;

    // temp test to get series working. skips movies
    if (vtype !== 'series') {
      console.log(`Skipping non-series title: ${title}`);
      continue; 
    }

    const showSubtitlesDir = path.join(subtitlesDir, title);
    if (!fs.existsSync(showSubtitlesDir)) {
      fs.mkdirSync(showSubtitlesDir);
    }

    let season = 1;
    let episode = 1;
    let isNextEpisodeAvailable = true;

    async function moveMouseAndFetchEpisodeInfo() {
      await page.mouse.move(500, 500);
      await page.waitForSelector('[data-uia="video-title"]', {
        visible: true,
      });
      const episodeInfo = await page.evaluate(() => {
        const videoTitleElement = document.querySelector(
          '[data-uia="video-title"]'
        );
        if (videoTitleElement) {
          const seasonEpisodeText = videoTitleElement
            .querySelector('span')
            .textContent.trim();
          const episodeText = videoTitleElement
            .querySelector('span:nth-child(2)')
            .textContent.trim();
          return `${seasonEpisodeText} ${episodeText}`;
        }
        return null;
      });
      return episodeInfo;
    }

    page.on('request', (request) => {
      if (request.url().includes('?o') && request.url().endsWith('.xml')) {
        request.continue();
      } else {
        request.continue();
      }
    });

    page.on('response', async (response) => {
      if (response.url().includes('?o') && response.url().endsWith('.xml')) {
        const subtitles = await response.text();
        const episodeName = `${title} S${String(season).padStart(
          2,
          '0'
        )}E${String(episode).padStart(2, '0')}`;
        const subtitlePath = path.join(showSubtitlesDir, `${episodeName}.xml`);
        fs.writeFileSync(subtitlePath, subtitles);
        subtitleLink = `./subtitles/${title}/${episodeName}.xml`;
        console.log(`Captured subtitles for ${episodeName}`);
      }
    });

    await page.waitForSelector('[data-uia="play-button"]', { visible: true });
    await page.click('[data-uia="play-button"]');

    while (isNextEpisodeAvailable) {
      const episodeInfo = await moveMouseAndFetchEpisodeInfo();
      console.log(`Detected episode info: ${episodeInfo}`);

      await page.waitForTimeout(10000);

      try {
        await page.waitForSelector('[data-icon="nextEpisodeStandard"]', {
          visible: true,
          timeout: 5000,
        });
        await page.click('[data-icon="nextEpisodeStandard"]');
        episode++;

        const newEpisodeInfo = await moveMouseAndFetchEpisodeInfo();
        if (newEpisodeInfo && newEpisodeInfo.includes('E1')) {
          season++;
          episode = 1;
        }
      } catch (error) {
        isNextEpisodeAvailable = false;
        console.log(`No more episodes available for ${title}`);
      }
    }

    results.push({ nfid, title, url, genreTags, subtitleLink });
    console.log(`Processed Title: ${title} (ID: ${nfid})`);
  }

  await browser.close();

  fs.writeFileSync(
    'netflix_details_with_subtitles.json',
    JSON.stringify(results, null, 2)
  );
  console.log(
    'Details collection complete. Results saved to netflix_details_with_subtitles.json'
  );
})();
