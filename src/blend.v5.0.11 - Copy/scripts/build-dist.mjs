import {
  access,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = join(projectRoot, 'dist');
const runtimeExtensions = new Set(['.css', '.html', '.js', '.svg', '.webmanifest']);
const excludedRuntimeFiles = new Set([
  'playwright.config.js',
  'ipfs-helia-provider.source.js'
]);
const additionalFiles = new Set([
  'README.md',
  'CHANGELOG.md',
  'VERSIONS.md',
  'GIT_PLAYLIST_STORAGE_DESIGN.md',
  'STORAGE_POLICY_VERIFICATION.md',
  'alias-manifest.json',
  'manifest.json',
  'about-hero-dark-full.png'
]);
const requiredFiles = [
  'index.html',
  'slideshow-playlist-player.html',
  'offline.html',
  'styles.css',
  'app.js',
  'pwa-config.js',
  'service-worker.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-maskable.svg',
  'README.md'
];

function isMissing(error) {
  return error?.code === 'ENOENT';
}

async function listPublishableFiles() {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  const selected = new Set();

  for (const entry of entries) {
    const name = entry.name;
    const isRuntimeFile = runtimeExtensions.has(extname(name).toLowerCase())
      && !excludedRuntimeFiles.has(name);

    if (isRuntimeFile || additionalFiles.has(name)) {
      if (!entry.isFile()) {
        throw new Error(`Expected a regular source file: ${name}`);
      }
      selected.add(name);
    }
  }

  for (const name of requiredFiles) {
    if (!selected.has(name)) {
      throw new Error(`Required web application file is missing: ${name}`);
    }
  }

  return [...selected].sort();
}

function outputPathForPrecacheEntry(entry) {
  const pathWithoutQuery = String(entry).split(/[?#]/, 1)[0];
  if (/^[a-z][a-z\d+.-]*:/i.test(pathWithoutQuery) || pathWithoutQuery.startsWith('/')) {
    throw new Error(`Expected a relative PWA asset path, got: ${entry}`);
  }

  const normalized = posix.normalize(pathWithoutQuery.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '') return 'index.html';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`PWA asset path escapes the application root: ${entry}`);
  }
  return normalized;
}

async function verifyPwaPrecache(stageDirectory) {
  await import(pathToFileURL(join(projectRoot, 'pwa-config.js')).href);
  const config = globalThis.BlendPwaConfig;
  if (!config || !Array.isArray(config.PRECACHE_REQUIRED)) {
    throw new Error('Could not read the app PWA precache configuration');
  }

  const missingAssets = [];
  for (const entry of config.PRECACHE_REQUIRED) {
    const assetPath = outputPathForPrecacheEntry(entry);
    try {
      await access(join(stageDirectory, ...assetPath.split('/')));
    } catch (error) {
      if (!isMissing(error)) throw error;
      missingAssets.push(assetPath);
    }
  }

  if (missingAssets.length > 0) {
    throw new Error(`Build is missing required PWA assets: ${missingAssets.join(', ')}`);
  }
}

async function existingDistInfo() {
  try {
    const info = await lstat(distDirectory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Refusing to replace dist because it is not a regular directory');
    }
    return info;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function build() {
  const files = await listPublishableFiles();
  const packageInfo = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const stageDirectory = await mkdtemp(join(projectRoot, '.dist-stage-'));
  let stageMoved = false;
  let backupDirectory = null;
  let oldDistMoved = false;

  try {
    for (const name of files) {
      await copyFile(join(projectRoot, name), join(stageDirectory, name));
    }

    await verifyPwaPrecache(stageDirectory);

    const oldDist = await existingDistInfo();
    if (oldDist) {
      backupDirectory = join(projectRoot, `.dist-backup-${randomUUID()}`);
      await rename(distDirectory, backupDirectory);
      oldDistMoved = true;
    }

    try {
      await rename(stageDirectory, distDirectory);
      stageMoved = true;
    } catch (error) {
      if (oldDistMoved) {
        await rename(backupDirectory, distDirectory);
        oldDistMoved = false;
      }
      throw error;
    }

    if (oldDistMoved) {
      try {
        await rm(backupDirectory, { recursive: true, force: true });
        oldDistMoved = false;
      } catch (error) {
        console.warn(`Build succeeded, but old output cleanup failed: ${error.message}`);
      }
    }

    console.log(`Built Blend ${packageInfo.version} with ${files.length} files in dist/`);
  } finally {
    if (!stageMoved) {
      await rm(stageDirectory, { recursive: true, force: true });
    }
  }
}

build().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
