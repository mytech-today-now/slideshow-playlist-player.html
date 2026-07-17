import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const uploadedContentByCid = new Map();

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

function buildSharedExperienceV2() {
  const createdAt = '2026-06-22T00:00:00.000Z';
  const playlistUrl = `http://${HOST}:${PORT}/samples/nyc-01.mp4`;
  const slideshowUrl = `http://${HOST}:${PORT}/samples/IL.jpeg`;
  return {
    schema: 'player.blend.experience.v2',
    type: 'experience',
    id: 'exp-shared-supabase-e2e',
    name: 'Shared Supabase Experience',
    exportedAt: createdAt,
    settings: {
      resumeOnLoad: false,
      playbackModePlaylist: 'sequential',
      playbackModeSlideshow: 'sequential'
    },
    playlist: {
      type: 'playlist',
      name: 'Playlist',
      description: '',
      createdAt,
      order: ['playlist-item-1'],
      items: [
        {
          id: 'playlist-item-1',
          path: playlistUrl,
          sourceUrl: playlistUrl,
          name: 'nyc-01.mp4',
          type: 'video',
          available: true,
          order: 0
        }
      ]
    },
    slideshow: {
      type: 'slideshow',
      name: 'Slideshow',
      description: '',
      createdAt,
      order: ['slideshow-item-1'],
      items: [
        {
          id: 'slideshow-item-1',
          path: slideshowUrl,
          sourceUrl: slideshowUrl,
          name: 'IL.jpeg',
          type: 'image',
          displayDuration: 4,
          available: true,
          order: 0
        }
      ]
    }
  };
}

function writeCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function encodeBase32(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const value of bytes) {
    buffer = (buffer << 8) | value;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function cidForContent(content, tag = '') {
  const hash = createHash('sha256').update(content).update(String(tag || '')).digest();
  return `b${encodeBase32(hash)}`;
}

function parseMultipartParts(body, contentType) {
  const boundaryMatch = /boundary=([^;]+)/i.exec(String(contentType || ''));
  if (!boundaryMatch) return [];
  const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, '');
  if (!boundary) return [];

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(boundaryBuffer);
  while (cursor !== -1) {
    cursor += boundaryBuffer.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break; // "--" final boundary
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2; // CRLF

    const nextBoundary = body.indexOf(boundaryBuffer, cursor);
    if (nextBoundary === -1) break;

    let part = body.slice(cursor, nextBoundary);
    if (part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      cursor = nextBoundary;
      continue;
    }

    const headersText = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);
    const contentDisposition = /content-disposition:\s*([^\r\n]+)/i.exec(headersText)?.[1] || '';
    const name = /name="([^"]+)"/i.exec(contentDisposition)?.[1] || '';
    const filename = /filename="([^"]*)"/i.exec(contentDisposition)?.[1] || '';
    const partContentType = /content-type:\s*([^\r\n]+)/i.exec(headersText)?.[1]?.trim() || 'application/octet-stream';
    parts.push({ name, filename, contentType: partContentType, data });
    cursor = nextBoundary;
  }

  return parts;
}

function storeUploadedContent(content, contentType = 'application/octet-stream', filename = '') {
  const cid = cidForContent(content, `${contentType}|${filename}`);
  if (!uploadedContentByCid.has(cid)) {
    uploadedContentByCid.set(cid, {
      content,
      contentType
    });
  }
  return cid;
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function payloadForCid(cid) {
  if (!cid) return null;

  const uploaded = uploadedContentByCid.get(cid);
  if (uploaded) {
    return {
      statusCode: 200,
      contentType: uploaded.contentType || 'application/octet-stream',
      body: uploaded.content
    };
  }

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

async function handleKuboApi(req, res, url) {
  const pathname = url.pathname;
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
    const body = await readRequestBody(req);
    const parts = parseMultipartParts(body, req.headers['content-type']);
    const filePart = parts.find(part => part.name === 'file') || parts[0] || null;
    const bytes = filePart?.data || body;
    const contentType = filePart?.contentType || 'application/octet-stream';
    const filename = filePart?.filename || 'upload.bin';
    const cid = storeUploadedContent(bytes, contentType, filename);
    const delayMs = isSlow ? 5000 : 50;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(`${JSON.stringify({ Name: filename, Hash: cid, Size: String(bytes.byteLength || bytes.length || 0) })}\n`);
    return true;
  }

  if (req.method === 'POST' && suffix === '/api/v0/cat') {
    await readRequestBody(req);
    const cid = decodeURIComponent(url.searchParams.get('arg') || '').trim();
    const payload = payloadForCid(cid);
    if (!payload) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return true;
    }
    res.statusCode = payload.statusCode;
    res.setHeader('Content-Type', payload.contentType);
    res.end(payload.body);
    return true;
  }

  return false;
}

function tryIpfsGatewayPayload(pathname) {
  const match = /^\/ipfs\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const cid = decodeURIComponent(match[1] || '').trim();
  if (!cid) return null;
  return payloadForCid(cid);
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

function cacheControlForStatic(url, filePath) {
  const basename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  if (basename === 'service-worker.js' || basename === 'sw.js' || ext === '.html') {
    return 'no-cache';
  }
  if (basename === 'alias-manifest.json') {
    return 'no-cache';
  }
  if (url.searchParams.has('v') || ['.svg', '.png', '.jpg', '.jpeg', '.css', '.js'].includes(ext)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
}

async function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }

  const filePath = safePathFromUrlPath(url.pathname);
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const etag = `"${createHash('sha256').update(data).digest('hex').slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', cacheControlForStatic(url, filePath));
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', String(data.byteLength));
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControlForStatic(url, filePath));
    res.end(req.method === 'HEAD' ? undefined : data);
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
      const handled = await handleKuboApi(req, res, url);
      if (handled) return;
    }
    if (pathname.startsWith('/ipfs/')) {
      const handled = handleIpfsGateway(req, res, pathname);
      if (handled) return;
    }
    if (req.method === 'GET' && pathname === '/e2e/shared-experience.v2.json') {
      sendJson(res, 200, buildSharedExperienceV2());
      return;
    }

    await handleStatic(req, res, url);
  } catch (error) {
    res.statusCode = 500;
    res.end(`Server error: ${error?.message || error}`);
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Fixture server listening at http://${HOST}:${PORT}`);
});
