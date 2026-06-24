import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const dist = join(root, 'dist');

const files = [
  'index.html',
  'slideshow-playlist-player.html',
  'styles.css',
  'app.js',
  'logger.js',
  'drag-sort.js',
  'ipfs-service.js',
  'ipfs-manifest.js',
  'ipfs-share-warning.js',
  'ipfs-worker-client.js',
  'ipfs-worker-protocol.js',
  'ipfs-worker.js',
  'ipfs-helia-provider.js',
  'ipfs-helia-provider.bundle.js',
  'service-worker.js',
  'sw.js',
  'manifest.json',
  'manifest.webmanifest',
  'assets'
];

async function copyEntry(entry) {
  await cp(join(root, entry), join(dist, entry), {
    recursive: true,
    force: true,
    verbatimSymlinks: false
  });
}

await build({
  entryPoints: [join(root, 'ipfs-helia-provider.source.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: join(root, 'ipfs-helia-provider.bundle.js')
});
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await copyEntry(file);
}

console.log(`Built deployable static app at ${dist}`);
