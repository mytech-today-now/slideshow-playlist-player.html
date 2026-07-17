import { promises as fs } from 'node:fs';
import path from 'node:path';

const NYC_PLAYLIST_SOURCE_URL = 'https://raw.githubusercontent.com/mytech-today-now/slideshow-playlist-player.html/refs/heads/main/samples/NYC-playlist.txt';
const NYC_SLIDESHOW_SOURCE_URL = 'https://raw.githubusercontent.com/mytech-today-now/slideshow-playlist-player.html/refs/heads/main/samples/nyc-slideshow.txt';
const PATRIOTIC_PLAYLIST_SOURCE_URL = 'https://dn710002.ca.archive.org/0/items/national-anthem-united-states-star-spangled-banner/United%20States%20of%20America%20National%20Anthem%20%28Instrumental%29.mp3';
const PATRIOTIC_SLIDESHOW_SOURCE_URL = 'https://raw.githubusercontent.com/mytech-today-now/slideshow-playlist-player.html/refs/heads/main/samples/4th.txt';

const RETRY_DELAY_MS = 200;

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
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

function parseListEntries(content) {
  return String(content || '')
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.replace(/^"(.*)"$/, '$1').trim())
    .filter(line => /^https?:\/\//i.test(line));
}

function normalizeListContent(content, sourceUrl) {
  const base = new URL(sourceUrl);
  return String(content || '')
    .split(/\r?\n/g)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return '';
      const unquoted = trimmed.replace(/^"(.*)"$/, '$1').trim();
      if (!unquoted) return '';
      if (/^https?:\/\//i.test(unquoted)) return unquoted;
      if (/^[a-zA-Z]:[\\/]/.test(unquoted)) return '';
      if (/^\\\\/.test(unquoted)) return '';
      try {
        return new URL(unquoted, base).href;
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n')
    .concat('\n');
}

export async function prepareLifecycleListArtifacts(testInfo, runSuffix) {
  const artifactsDir = testInfo.outputPath(`experience-lifecycle-${runSuffix}`);
  await fs.mkdir(artifactsDir, { recursive: true });

  const nycPlaylistText = await fetchText(NYC_PLAYLIST_SOURCE_URL);
  const nycSlideshowText = await fetchText(NYC_SLIDESHOW_SOURCE_URL);
  const patrioticSlideshowText = await fetchText(PATRIOTIC_SLIDESHOW_SOURCE_URL);
  const patrioticPlaylistText = `${PATRIOTIC_PLAYLIST_SOURCE_URL}\n`;

  const nycPlaylistNormalized = normalizeListContent(nycPlaylistText, NYC_PLAYLIST_SOURCE_URL);
  const nycSlideshowNormalized = normalizeListContent(nycSlideshowText, NYC_SLIDESHOW_SOURCE_URL);
  const patrioticSlideshowNormalized = normalizeListContent(patrioticSlideshowText, PATRIOTIC_SLIDESHOW_SOURCE_URL);

  const nycPlaylistPath = path.join(artifactsDir, `nyc-playlist-${runSuffix}.txt`);
  const nycSlideshowPath = path.join(artifactsDir, `nyc-slideshow-${runSuffix}.txt`);
  const patrioticPlaylistPath = path.join(artifactsDir, `patriotic-playlist-${runSuffix}.txt`);
  const patrioticSlideshowPath = path.join(artifactsDir, `patriotic-slideshow-${runSuffix}.txt`);

  await Promise.all([
    fs.writeFile(nycPlaylistPath, nycPlaylistNormalized, 'utf8'),
    fs.writeFile(nycSlideshowPath, nycSlideshowNormalized, 'utf8'),
    fs.writeFile(patrioticPlaylistPath, patrioticPlaylistText, 'utf8'),
    fs.writeFile(patrioticSlideshowPath, patrioticSlideshowNormalized, 'utf8')
  ]);

  return {
    paths: {
      nycPlaylistPath,
      nycSlideshowPath,
      patrioticPlaylistPath,
      patrioticSlideshowPath
    },
    sources: {
      nycPlaylistSourceUrl: NYC_PLAYLIST_SOURCE_URL,
      nycSlideshowSourceUrl: NYC_SLIDESHOW_SOURCE_URL,
      patrioticPlaylistSourceUrl: PATRIOTIC_PLAYLIST_SOURCE_URL,
      patrioticSlideshowSourceUrl: PATRIOTIC_SLIDESHOW_SOURCE_URL
    },
    expected: {
      nycPlaylistUrls: parseListEntries(nycPlaylistNormalized),
      nycSlideshowUrls: parseListEntries(nycSlideshowNormalized),
      patrioticPlaylistUrls: parseListEntries(patrioticPlaylistText),
      patrioticSlideshowUrls: parseListEntries(patrioticSlideshowNormalized)
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
