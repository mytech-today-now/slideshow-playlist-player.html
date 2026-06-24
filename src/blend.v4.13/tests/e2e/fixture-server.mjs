import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4191);

const KUBO_CID = 'bafybeiab47tncsmv4ystfwwh3zujdipnfmgporoahsppz6g22t7uifpfqe';
const SHARED_MANIFEST_CID = KUBO_CID;
const SHARED_IMAGE_CID = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const SHARED_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z8DwHwAFgwJ/l7h5WQAAAABJRU5ErkJggg==',
  'base64'
);

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
});

function buildSharedExperienceManifest() {
  const createdAt = '2026-06-20T00:00:00.000Z';
  const remoteVideoUrl = `https://${HOST.replace(/\./g, '-')}.media.example.test/nyc-01.mp4`;
  return {
    schema: 'player.blend.ipfs-experience.v1',
    schemaVersion: 1,
    createdAt,
    appVersion: '4.12.0-e2e',
    experienceId: 'exp-ipfs-shared-e2e',
    experienceTitle: 'Shared NYC Experience',
    items: [
      {
        itemId: 'image-ipfs-1',
        cid: SHARED_IMAGE_CID,
        type: 'image',
        mimeType: 'image/png',
        byteSize: SHARED_IMAGE_BYTES.byteLength,
        name: 'city-frame.png',
        title: 'City Frame'
      },
      {
        itemId: 'video-remote-1',
        sourceUrl: remoteVideoUrl,
        type: 'video',
        mimeType: 'video/mp4',
        byteSize: 2600000,
        name: 'nyc-01.mp4',
        title: 'NYC Clip',
        duration: 12
      }
    ],
    playbackSettings: {
      resumeOnLoad: false,
      playbackModePlaylist: 'sequential',
      playbackModeSlideshow: 'sequential'
    },
    lists: {
      playlist: {
        name: 'Playlist',
        description: '',
        createdAt,
        order: ['video-remote-1'],
        items: [
          {
            order: 0,
            itemId: 'video-remote-1',
            sourceUrl: remoteVideoUrl,
            type: 'video',
            title: 'NYC Clip'
          }
        ]
      },
      slideshow: {
        name: 'Slideshow',
        description: '',
        createdAt,
        order: ['image-ipfs-1'],
        items: [
          {
            order: 0,
            itemId: 'image-ipfs-1',
            cid: SHARED_IMAGE_CID,
            type: 'image',
            title: 'City Frame',
            displayDuration: 3
          }
        ]
      }
    },
    migration: {
      sourceSchema: 'player.blend.experience.v2',
      notes: 'Fixture manifest for end-to-end import tests.'
    }
  };
}

function writeCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readRequestBody(req) {
  for await (const _ of req) {
    // Drain request body; parsing is not required for this fake endpoint.
  }
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function handleKuboApi(req, res, pathname) {
  const isSlow = pathname.startsWith('/slow/');
  const suffix = isSlow ? pathname.slice('/slow'.length) : pathname;

  writeCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method === 'POST' && suffix === '/api/v0/version') {
    await readRequestBody(req);
    sendJson(res, 200, { Version: '0.0.0-e2e-kubo' });
    return true;
  }

  if (req.method === 'POST' && suffix === '/api/v0/add') {
    await readRequestBody(req);
    const delayMs = isSlow ? 5000 : 50;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(`${JSON.stringify({ Name: 'blend-experience-manifest.json', Hash: KUBO_CID, Size: '2683' })}\n`);
    return true;
  }

  return false;
}

function tryIpfsGatewayPayload(pathname) {
  const match = /^\/ipfs\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const cid = decodeURIComponent(match[1] || '').trim();
  if (!cid) return null;
  if (cid === SHARED_MANIFEST_CID) {
    return {
      statusCode: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(buildSharedExperienceManifest())
    };
  }
  if (cid === SHARED_IMAGE_CID) {
    return {
      statusCode: 200,
      contentType: 'image/png',
      body: SHARED_IMAGE_BYTES
    };
  }
  return {
    statusCode: 404,
    contentType: 'text/plain; charset=utf-8',
    body: 'Not found'
  };
}

function handleIpfsGateway(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const payload = tryIpfsGatewayPayload(pathname);
  if (!payload) return false;
  res.statusCode = payload.statusCode;
  res.setHeader('Content-Type', payload.contentType);
  res.end(req.method === 'HEAD' ? undefined : payload.body);
  return true;
}

function safePathFromUrlPath(urlPath) {
  const normalized = urlPath === '/' ? '/index.html' : urlPath;
  const decoded = decodeURIComponent(normalized);
  const absolute = path.resolve(ROOT, `.${decoded}`);
  if (!absolute.startsWith(ROOT)) return null;
  return absolute;
}

async function handleStatic(req, res, pathname) {
  const filePath = safePathFromUrlPath(pathname);
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.end(data);
  } catch (_) {
    res.statusCode = 404;
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/v0/') || pathname.startsWith('/slow/api/v0/')) {
      const handled = await handleKuboApi(req, res, pathname);
      if (handled) return;
    }
    if (pathname.startsWith('/ipfs/')) {
      const handled = handleIpfsGateway(req, res, pathname);
      if (handled) return;
    }

    await handleStatic(req, res, pathname);
  } catch (error) {
    res.statusCode = 500;
    res.end(`Server error: ${error?.message || error}`);
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Fixture server listening at http://${HOST}:${PORT}`);
});
