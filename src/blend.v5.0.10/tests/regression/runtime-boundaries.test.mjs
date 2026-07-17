import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);

test('runtime app path no longer imports IPFS modules', async () => {
  const app = await readFile(new URL('app.js', ROOT), 'utf8');
  assert.equal(app.includes("from './ipfs-service"), false);
  assert.equal(app.includes("from './ipfs-manifest"), false);
  assert.equal(app.includes("from './ipfs-share-warning"), false);
});

test('package dependencies do not include helia runtime packages', async () => {
  const pkgRaw = await readFile(new URL('package.json', ROOT), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const deps = pkg.dependencies || {};
  assert.equal('helia' in deps, false);
  assert.equal('@helia/unixfs' in deps, false);
  assert.equal('multiformats' in deps, false);
});
