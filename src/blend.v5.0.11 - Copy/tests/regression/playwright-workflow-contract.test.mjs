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
  assert.match(readme, /Current discovery on 2026-10-21, using `npx playwright test --config=playwright\.config\.mjs --list`, exited 0 and listed 318 tests in 46 files: 256 Chromium tests and 31 tagged smoke tests each in Firefox and WebKit/);
  assert.match(readme, /These are configured inventories, not assertion results/);
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

test('README distinguishes startup failures from the current Playwright baseline', async () => {
  const readme = await read('README.md');

  assert.match(readme, /historical 189-test full run recorded 171 passes and 18 failures/);
  assert.match(readme, /selected command `npm run test:e2e -- --project=chromium --reporter=line tests\/e2e\/supabase-auth\.e2e\.spec\.mjs` exited 1 with `Error: spawn EPERM` before discovery/);
  assert.match(readme, /that invocation ran zero browser assertions, so it was a runner startup failure and did not establish suite status/);
  assert.match(readme, /On 2026-10-21, the process-enabled `npm run test:e2e` against the dirty working tree based on revision `92e08696fe45b4b651661c20d68803add2433d21` completed 318 tests in 9\.2 minutes: 303 passed, 3 failed, and 12 skipped/);
  assert.match(readme, /Playwright Chromium 153\.0\.8010\.12 recorded 249\/3\/4, Firefox 155\.0 recorded 28\/0\/3, and WebKit 26\.6 recorded 26\/0\/5/);
  assert.match(readme, /each passed an isolated serial one-test trace rerun, so none reproduced/);
  assert.match(readme, /The full-suite baseline is known and non-green/);
  assert.match(readme, /unique report at `%TEMP%\\blend-issue07-full-process-bc16a59a7714469c9267c8feb2a6714a\\playwright-report\\` passed `node tests\/e2e\/verify-playwright-report\.mjs` with 5 files/);
  assert.doesNotMatch(readme, /full-suite browser E2E status remains unknown/);
  assert.match(readme, /Firefox also runs the actual offline-shell reload/);
  assert.match(readme, /Playwright WebKit's offline-shell case is recorded as skipped/);
  assert.match(readme, /Historical local records have no verified run date/);
});
