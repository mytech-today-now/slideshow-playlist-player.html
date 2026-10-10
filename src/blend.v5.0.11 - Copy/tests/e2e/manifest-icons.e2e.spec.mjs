import { expect, test } from '@playwright/test';

const deployments = [
  { name: 'root', appPath: '/index.html', assetPrefix: '' },
  { name: 'nested', appPath: '/nested/blend/index.html', assetPrefix: '/nested/blend' }
];

for (const deployment of deployments) {
  test(`loads versioned manifest icons from the ${deployment.name} app path`, async ({ page }) => {
    const requestedPaths = [];
    page.on('request', request => {
      requestedPaths.push(new URL(request.url()).pathname);
    });

    await page.goto(deployment.appPath, { waitUntil: 'domcontentloaded' });
    const manifest = await page.evaluate(async () => {
      const manifestUrl = new URL(document.querySelector('link[rel="manifest"]').href);
      const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
      const data = await manifestResponse.json();
      const icons = await Promise.all(data.icons.map(async icon => {
        const url = new URL(icon.src, manifestUrl);
        const response = await fetch(url, { cache: 'no-store' });
        return {
          path: url.pathname,
          version: url.searchParams.get('v'),
          manifestVersion: manifestUrl.searchParams.get('v'),
          status: response.status,
          contentType: response.headers.get('content-type')
        };
      }));
      return { status: manifestResponse.status, icons };
    });

    expect(manifest.status).toBe(200);
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons.map(icon => icon.path)).toEqual([
      `${deployment.assetPrefix}/icon.svg`,
      `${deployment.assetPrefix}/icon-maskable.svg`
    ]);
    for (const icon of manifest.icons) {
      expect(icon.status).toBe(200);
      expect(icon.contentType).toContain('image/svg+xml');
      expect(icon.version).toBeTruthy();
      expect(icon.version).toBe(icon.manifestVersion);
    }
    expect(requestedPaths.some(path => /\/assets\/icon(?:-maskable)?\.svg$/.test(path))).toBe(false);
  });
}
