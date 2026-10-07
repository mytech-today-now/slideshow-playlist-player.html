import { promises as fs } from 'node:fs';
import path from 'node:path';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

const NYC_PLAYLIST_URLS = Object.freeze([
  `${FIXTURE_ORIGIN}/samples/nyc-01.mp4`,
  `${FIXTURE_ORIGIN}/samples/1983-music-only.mp3`
]);

const NYC_SLIDESHOW_URLS = Object.freeze([
  `${FIXTURE_ORIGIN}/samples/IL.jpeg`,
  `${FIXTURE_ORIGIN}/samples/blotter-01.png`,
  `${FIXTURE_ORIGIN}/samples/its-a-trap.jpg`
]);

const PATRIOTIC_PLAYLIST_URLS = Object.freeze([
  `${FIXTURE_ORIGIN}/samples/1983-music-only.mp3`,
  `${FIXTURE_ORIGIN}/samples/nyc-01.mp4`
]);

const PATRIOTIC_SLIDESHOW_URLS = Object.freeze([
  `${FIXTURE_ORIGIN}/assets/icon.svg`,
  `${FIXTURE_ORIGIN}/assets/icon-maskable.svg`,
  `${FIXTURE_ORIGIN}/samples/IL.jpeg`
]);

const RETRY_DELAY_MS = 200;

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function listFileContent(lines) {
  return `${(lines || []).map(line => String(line || '').trim()).filter(Boolean).join('\n')}\n`;
}

export function createRunSuffix(testInfo) {
  const forced = String(process.env.E2E_RUN_SUFFIX || '').trim();
  if (forced) return forced;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-w${testInfo.workerIndex}-r${testInfo.retry}`;
}

export function createExperienceNames(runSuffix) {
  return {
    nyc: `NYC - Test ${runSuffix}`,
    patriotic: `Patriotic - Test ${runSuffix}`,
    renamed: `Rename Test ${runSuffix}`
  };
}

export async function prepareLifecycleListArtifacts(testInfo, runSuffix) {
  const artifactsDir = testInfo.outputPath(`experience-lifecycle-${runSuffix}`);
  await fs.mkdir(artifactsDir, { recursive: true });

  const nycPlaylistPath = path.join(artifactsDir, `nyc-playlist-${runSuffix}.txt`);
  const nycSlideshowPath = path.join(artifactsDir, `nyc-slideshow-${runSuffix}.txt`);
  const patrioticPlaylistPath = path.join(artifactsDir, `patriotic-playlist-${runSuffix}.txt`);
  const patrioticSlideshowPath = path.join(artifactsDir, `patriotic-slideshow-${runSuffix}.txt`);

  await Promise.all([
    fs.writeFile(nycPlaylistPath, listFileContent(NYC_PLAYLIST_URLS), 'utf8'),
    fs.writeFile(nycSlideshowPath, listFileContent(NYC_SLIDESHOW_URLS), 'utf8'),
    fs.writeFile(patrioticPlaylistPath, listFileContent(PATRIOTIC_PLAYLIST_URLS), 'utf8'),
    fs.writeFile(patrioticSlideshowPath, listFileContent(PATRIOTIC_SLIDESHOW_URLS), 'utf8')
  ]);

  return {
    paths: {
      nycPlaylistPath,
      nycSlideshowPath,
      patrioticPlaylistPath,
      patrioticSlideshowPath
    },
    sources: {
      nycPlaylistSourceUrl: 'local-fixture',
      nycSlideshowSourceUrl: 'local-fixture',
      patrioticPlaylistSourceUrl: 'local-fixture',
      patrioticSlideshowSourceUrl: 'local-fixture'
    },
    expected: {
      nycPlaylistUrls: NYC_PLAYLIST_URLS.slice(),
      nycSlideshowUrls: NYC_SLIDESHOW_URLS.slice(),
      patrioticPlaylistUrls: PATRIOTIC_PLAYLIST_URLS.slice(),
      patrioticSlideshowUrls: PATRIOTIC_SLIDESHOW_URLS.slice()
    }
  };
}

export async function saveDownloadWithRetry(download, outputPath, attempts = 3) {
  let lastError = null;
  for (let index = 0; index < attempts; index++) {
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.rm(outputPath, { force: true });
      await download.saveAs(outputPath);
      const stat = await fs.stat(outputPath);
      if (stat.size <= 0) throw new Error(`Saved file is empty: ${outputPath}`);
      return outputPath;
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) await wait(RETRY_DELAY_MS * (index + 1));
    }
  }
  throw lastError || new Error(`Could not save download to ${outputPath}`);
}
