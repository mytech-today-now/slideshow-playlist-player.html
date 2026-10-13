export async function attachBrowserEngineEvidence(browser, testInfo) {
  const version = browser.version();
  const evidence = `${testInfo.project.name}\n${version}\n`;
  testInfo.annotations.push({
    type: 'browser-engine-version',
    description: `${testInfo.project.name}: ${version}`
  });
  await testInfo.attach('browser-engine-version.txt', {
    body: Buffer.from(evidence, 'utf8'),
    contentType: 'text/plain'
  });
}
