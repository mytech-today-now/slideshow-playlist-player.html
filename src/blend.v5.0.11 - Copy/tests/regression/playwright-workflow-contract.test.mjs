import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFile(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const playwrightConfig = (await import('../../playwright.config.mjs')).default;

test('Playwright command, browser projects, spec selection, and README inventory align', async () => {
  const readme = await read('README.md');
  const specFiles = (await readdir(path.join(root, 'tests/e2e')))
    .filter(name => name.endsWith('.e2e.spec.mjs'))
    .sort();
  const projects = playwrightConfig.projects;
  const projectNames = projects.map(project => project.name);
  const firefox = projects.find(project => project.name === 'firefox');
  const webkit = projects.find(project => project.name === 'webkit');
  const crossEngineSmokeSpecs = specFiles.filter(name => firefox.testMatch.test(name));

  assert.equal(packageJson.scripts['test:e2e'], 'playwright test --config=playwright.config.mjs');
  assert.deepEqual(projectNames, ['chromium', 'firefox', 'webkit']);
  assert.equal(projects.find(project => project.name === 'chromium').testMatch, undefined);
  assert.equal(projects.find(project => project.name === 'chromium').grep, undefined);
  assert.match(firefox.grep.toString(), /@cross-engine-smoke/);
  assert.match(webkit.grep.toString(), /@cross-engine-smoke/);
  assert.deepEqual(crossEngineSmokeSpecs, [
    'add-files-selection-limit.e2e.spec.mjs',
    'browser-compatibility.e2e.spec.mjs',
    'directory-scan-visibility.e2e.spec.mjs',
    'experience-import-atomicity.e2e.spec.mjs',
    'pwa-offline.e2e.spec.mjs',
    'save-lifecycle.e2e.spec.mjs',
    'thumbnail-failures.e2e.spec.mjs'
  ]);
  assert.deepEqual(specFiles.filter(name => webkit.testMatch.test(name)), crossEngineSmokeSpecs);
  assert.deepEqual(playwrightConfig.reporter.map(([name]) => name), ['list', 'html']);
  assert.equal(playwrightConfig.reporter[1][1].outputFolder, 'playwright-report');

  assert.match(readme, /Before the Issue 09 smoke-matrix addition on 2026-10-13, `npm run test:e2e -- --list` selected 281 tests in 46 files/);
  assert.match(readme, /The current configured matrix lists 291 tests: 237 Chromium tests and 27 tagged smoke tests each in Firefox and WebKit/);
  assert.match(readme, /These are inventories, not assertion results/);
});

test('CI invokes the full suite and uploads only a verified report after test failure', async () => {
  const workflow = await read('.github/workflows/playwright.yml');

  assert.match(workflow, /run:\s*npm run test:e2e/);
  assert.match(workflow, /id:\s*playwright/);
  assert.match(workflow, /id:\s*verify_report/);
  assert.match(workflow, /steps\.playwright\.outcome != 'skipped'/);
  assert.match(workflow, /steps\.verify_report\.outcome == 'success'/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(workflow, /path:\s*playwright-report\//);
  assert.match(workflow, /retention-days:\s*30/);
});

test('README separates the current launch failure from historical browser outcomes', async () => {
  const readme = await read('README.md');

  assert.match(readme, /historical 189-test full run recorded 171 passes and 18 failures/);
  assert.match(readme, /full `npm run test:e2e` attempt stopped before test execution with `Error: spawn EPERM`/);
  assert.match(readme, /full-suite browser E2E status remains unknown/);
  assert.match(readme, /Firefox also runs the actual offline-shell reload/);
  assert.match(readme, /Playwright WebKit's offline-shell case is recorded as skipped/);
  assert.match(readme, /Historical local records have no verified run date/);
});
