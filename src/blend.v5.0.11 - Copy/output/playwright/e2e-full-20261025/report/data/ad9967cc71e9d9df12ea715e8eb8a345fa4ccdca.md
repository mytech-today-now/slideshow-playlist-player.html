# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: thumbnail-failures.e2e.spec.mjs >> Cross-engine thumbnail failure smoke >> a canvas failure releases queue capacity and preserves imported rows and playback
- Location: tests\e2e\thumbnail-failures.e2e.spec.mjs:459:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 3
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Go to configuration controls" [ref=e2]:
    - /url: "#config-gear"
  - region "Playback viewport" [ref=e3]:
    - generic:
      - generic: —
      - generic: •
      - generic: —
      - generic: •
      - generic: 50%
    - status: Loading next slide…
    - generic "Slideshow navigation":
      - button "Previous slideshow item" [ref=e9] [cursor=pointer]: <<
      - button "Next slideshow item" [ref=e10] [cursor=pointer]: ">>"
    - button "Close configuration panel" [expanded] [ref=e11] [cursor=pointer]: ⚙️
  - dialog "Configuration" [ref=e13]:
    - generic [ref=e14]:
      - generic [ref=e15]:
        - generic [ref=e17]:
          - generic [ref=e18]: Experience
          - combobox "Select experience" [disabled] [ref=e19]:
            - option "No experiences" [selected]
          - button "New" [ref=e20] [cursor=pointer]
          - button "Rename" [ref=e21] [cursor=pointer]
          - button "Delete" [ref=e22] [cursor=pointer]
          - button "Import" [ref=e23] [cursor=pointer]
          - button "Export" [ref=e24] [cursor=pointer]
          - button "Share URL" [ref=e25] [cursor=pointer]
          - button "Clear Browser Storage" [ref=e26] [cursor=pointer]
          - status [ref=e27]: Changes are not saved yet. Retry or export a backup before closing.
        - generic "Application version" [ref=e28]: v5.0.11
        - button "Open information dialog" [ref=e29] [cursor=pointer]
        - button "Close configuration panel" [ref=e32] [cursor=pointer]: ✕
      - toolbar "Playback controls" [ref=e33]:
        - button "Previous item" [ref=e34] [cursor=pointer]: ⏮
        - button "Play" [ref=e35] [cursor=pointer]: ▶
        - button "Next item" [ref=e36] [cursor=pointer]: ⏭
        - button "⏹" [disabled] [ref=e37] [cursor=pointer]
        - button "Provide Supabase API token" [ref=e38] [cursor=pointer]: 🔗
        - generic [ref=e39]:
          - generic [ref=e40]: Blend
          - slider "Blend opacity" [ref=e41]: "50"
          - generic [ref=e42]: 50%
        - button "Toggle fullscreen viewport" [ref=e43] [cursor=pointer]: ⛶
        - generic [ref=e44]:
          - button "Mute master volume" [ref=e45] [cursor=pointer]: 🔊
          - generic:
            - generic: 100%
            - slider "Master volume": "1"
    - generic [ref=e46]:
      - generic [ref=e47]:
        - generic [ref=e48]: Media Library (3)
        - generic [ref=e50]:
          - button "Add Files" [ref=e51] [cursor=pointer]
          - button "Add Folder" [ref=e52] [cursor=pointer]
          - button "Add URL" [ref=e53] [cursor=pointer]
          - button "Sort ▾" [ref=e54] [cursor=pointer]
          - button "Clear View" [ref=e55] [cursor=pointer]
          - button "Remove Stale" [ref=e56] [cursor=pointer]
        - searchbox "Search media… (/)" [ref=e57]
        - navigation "Media type filters" [ref=e58]:
          - link "All" [ref=e59] [cursor=pointer]:
            - /url: "#"
          - link "Video" [ref=e60] [cursor=pointer]:
            - /url: "#"
          - link "Audio" [ref=e61] [cursor=pointer]:
            - /url: "#"
          - link "Images" [ref=e62] [cursor=pointer]:
            - /url: "#"
          - group "Media source filter" [ref=e63]:
            - button "All" [ref=e64] [cursor=pointer]
            - button "Local" [ref=e65] [cursor=pointer]
            - button "URL" [ref=e66] [cursor=pointer]
        - listbox "Media Library" [ref=e67]:
          - generic [ref=e68]:
            - generic:
              - option "preview-fail-first.png, image, 326.6 KB" [ref=e69] [cursor=pointer]:
                - generic [aria-hidden] [ref=e70]: ≡
                - generic [ref=e71]: 🖼️
                - generic [ref=e72]:
                  - generic "./preview-fail-first.png" [ref=e73]: preview-fail-first.png
                  - generic [ref=e74]: ./preview-fail-first.png • 326.6 KB
                - generic [ref=e75]: image
              - option "preview-next.jpg, image, 106.3 KB" [ref=e76] [cursor=pointer]:
                - generic [aria-hidden] [ref=e77]: ≡
                - generic [ref=e78]: 🖼️
                - generic [ref=e79]:
                  - generic "./preview-next.jpg" [ref=e80]: preview-next.jpg
                  - generic [ref=e81]: ./preview-next.jpg • 106.3 KB
                - generic [ref=e82]: image
              - option "preview-last.jpeg, image, 73.9 KB" [ref=e83] [cursor=pointer]:
                - generic [aria-hidden] [ref=e84]: ≡
                - generic [ref=e85]: 🖼️
                - generic [ref=e86]:
                  - generic "./preview-last.jpeg" [ref=e87]: preview-last.jpeg
                  - generic [ref=e88]: ./preview-last.jpeg • 73.9 KB
                - generic [ref=e89]: image
        - generic [ref=e90]:
          - button "Add Selected → Playlist" [disabled] [ref=e91]
          - button "Add Selected → Slideshow" [disabled] [ref=e92]
          - button "Remove Selected" [disabled] [ref=e93]
      - generic [ref=e94]:
        - tablist [ref=e95]:
          - button "Playlist (0)" [ref=e96] [cursor=pointer]
          - button "Slideshow (0)" [ref=e97] [cursor=pointer]
        - list "Playlist editor" [ref=e98]:
          - generic "Drop media here" [ref=e99]:
            - text: Drop media here
            - strong [ref=e100]: Playlist accepts video & audio
        - region [ref=e101]:
          - generic [ref=e102]:
            - generic [ref=e103]:
              - heading "Playback timeline" [level=2] [ref=e104]
              - paragraph [ref=e105]: Video and audio timing comes from media metadata. Shared-link health is shown as a compact status; inspect it for details.
            - generic "Shared URL is comfortably below the browser compatibility limit. Open Share URL for exact size details." [ref=e106]: 🟢 SAFE
          - generic [ref=e107]:
            - generic [ref=e108]:
              - generic [ref=e109]: Playlist duration
              - strong [ref=e110]: 00:00
            - generic [ref=e111]:
              - generic [ref=e112]: Slideshow duration
              - strong [ref=e113]: 00:00
            - generic [ref=e114]:
              - generic [ref=e115]: Session runtime
              - strong [ref=e116]: 00:00
            - generic [ref=e117]:
              - generic [ref=e118]: Total media
              - strong [ref=e119]: 00:00
        - generic [ref=e120]:
          - generic "List organization actions" [ref=e121]:
            - button "Clear All" [ref=e122] [cursor=pointer]
            - button "Shuffle" [ref=e123] [cursor=pointer]
            - button "Sort ▾" [ref=e124] [cursor=pointer]
            - button "Reverse" [ref=e125] [cursor=pointer]
            - button "Remove selected items" [disabled] [ref=e126]: Remove Selected
            - button "Resolve links in both lists" [ref=e127] [cursor=pointer]: ↻ Resolve links
          - generic "List import and export actions" [ref=e128]:
            - button "Export…" [ref=e129] [cursor=pointer]
            - button "Import List…" [ref=e130] [cursor=pointer]
    - generic [ref=e131]:
      - generic [ref=e132]:
        - generic [ref=e133]:
          - generic [ref=e134]: Import behavior
          - combobox "Import behavior" [ref=e135]:
            - option "Append" [selected]
            - option "Replace current list"
        - generic [ref=e136]:
          - generic [ref=e137]: Theme
          - combobox "Theme" [ref=e138]:
            - option "Auto" [selected]
            - option "Dark"
            - option "Light"
        - generic [ref=e139]:
          - generic [ref=e140]: Effect intensity
          - combobox "Effect intensity" [ref=e141]:
            - option "Off"
            - option "Subtle" [selected]
            - option "Medium"
            - option "Strong"
        - generic [ref=e142]:
          - generic [ref=e143]: Experience playback mode
          - combobox "Experience playback mode" [ref=e144]:
            - option "Loop" [selected]
            - option "Stop at End"
            - option "Go to Next Experience"
        - generic [ref=e145]:
          - generic [ref=e146]: Playlist order
          - combobox "Playlist order" [ref=e147]:
            - option "Sequential" [selected]
            - option "Random"
        - generic [ref=e148]:
          - generic [ref=e149]: Slideshow order
          - combobox "Slideshow order" [ref=e150]:
            - option "Sequential" [selected]
            - option "Random"
        - generic [ref=e151]:
          - generic [ref=e152]: Default image duration
          - generic [ref=e153]:
            - spinbutton "Default image duration" [ref=e154]: "4"
            - generic [ref=e155]: s
        - generic [ref=e156] [cursor=pointer]:
          - checkbox "Loop experience catalog after last experience" [ref=e157]
          - generic [ref=e158]: Loop experience catalog after last experience
        - generic [ref=e159]:
          - generic [ref=e160]: Transition duration
          - generic [ref=e161]:
            - slider "Transition duration" [ref=e162]: "900"
            - generic [ref=e163]: 900ms
        - generic [ref=e164]:
          - generic [ref=e165]: Crossfade overlap
          - generic [ref=e166]:
            - slider "Crossfade overlap" [ref=e167]: "0"
            - generic [ref=e168]: 0ms
        - generic [ref=e169] [cursor=pointer]:
          - checkbox "Auto-adjust transition quality by FPS" [checked] [ref=e170]
          - generic [ref=e171]: Auto-adjust transition quality by FPS
        - generic [ref=e172] [cursor=pointer]:
          - checkbox "Show FPS monitor" [ref=e173]
          - generic [ref=e174]: Show FPS monitor
        - group [ref=e176]:
          - generic "Enabled Transitions ▾" [ref=e177] [cursor=pointer]
        - generic [ref=e178] [cursor=pointer]:
          - checkbox "Resume on load (paused; select Play to start)" [ref=e179]
          - generic [ref=e180]: Resume on load (paused; select Play to start)
        - generic [ref=e181] [cursor=pointer]:
          - checkbox "Auto-verify on startup" [checked] [ref=e182]
          - generic [ref=e183]: Auto-verify on startup
        - generic [ref=e184]:
          - generic [ref=e185] [cursor=pointer]:
            - checkbox "Allow usage analytics (event counts and broad media/share categories)" [ref=e186]
            - generic [ref=e187]: Allow usage analytics (event counts and broad media/share categories)
          - paragraph [ref=e188]: Tracks page, playback, and share events with media type/layer and share method/outcome. Google also receives a fixed Blend Player title/origin and standard browser/session metadata. Blend event parameters exclude user names, media IDs, item URLs/paths, and caller metadata.
          - status [ref=e189]: Analytics does not load until you enable it.
        - generic [ref=e190]:
          - generic [ref=e191]: Supabase media bucket
          - textbox "Supabase media bucket" [ref=e192]: media
        - generic [ref=e193]:
          - generic [ref=e194]: Signed URL TTL
          - generic [ref=e195]:
            - spinbutton "Signed URL TTL" [ref=e196]: "3600"
            - generic [ref=e197]: s
          - paragraph [ref=e198]: New private URLs use a one-hour lifetime by default. Change this owner setting only to match your Storage policy; URLs already issued keep their own expiry.
        - generic [ref=e199] [cursor=pointer]:
          - checkbox "Require auth for private media" [checked] [ref=e200]
          - generic [ref=e201]: Require auth for private media
        - generic [ref=e202]:
          - generic [ref=e203]: Supabase session
          - generic [ref=e204]:
            - status [ref=e205]: Provide API token to access private Supabase media.
            - generic [ref=e206]:
              - button "Use token" [ref=e207] [cursor=pointer]
              - button "Sign out" [disabled] [ref=e208]
          - paragraph [ref=e209]: Sign out requests Supabase's default global scope and can revoke refresh tokens for all sessions. Already issued access tokens may remain valid until they expire.
          - note [ref=e210]: Private URL sharing is blocked until the project owner verifies Storage access. You can share a public-only experience or continue local playback.
        - region [ref=e211]:
          - heading "Public Git playlist catalog" [level=2] [ref=e212]
          - paragraph [ref=e213]: Browse playlist JSON from a public GitHub or Bitbucket repository. This feature only reads public data. Public playlists and their commit history can be read by others.
          - generic [ref=e214]:
            - generic [ref=e215]:
              - generic [ref=e216]: Provider
              - combobox "Provider" [ref=e217]:
                - option "Choose a provider" [selected]
                - option "GitHub"
                - option "Bitbucket Cloud"
            - generic [ref=e218]:
              - generic [ref=e219]: Owner or workspace
              - textbox "Owner or workspace" [ref=e220]
            - generic [ref=e221]:
              - generic [ref=e222]: Repository
              - textbox "Repository" [ref=e223]
            - generic [ref=e224]:
              - generic [ref=e225]: Branch
              - textbox "Branch" [ref=e226]
            - generic [ref=e227]:
              - generic [ref=e228]: Catalog directory
              - textbox "Catalog directory" [ref=e229]
              - generic [ref=e230]: Contains index.v1.json and a playlists folder.
          - generic [ref=e231]:
            - button "Save settings" [ref=e232] [cursor=pointer]
            - button "Fetch public catalog" [ref=e233] [cursor=pointer]
          - status [ref=e234]: Choose a provider and enter the public repository details.
          - paragraph [ref=e235]: This shared catalog stays public and read-only. Your authenticated repository connection is separate and is never used as a catalog fallback.
        - region [ref=e236]:
          - heading "Connect and publish your playlist" [level=2] [ref=e237]
          - paragraph [ref=e238]: Connect directly from this browser to your GitHub or Bitbucket Cloud repository. Reads and writes are separate actions. GitHub writes require an explicit reviewed confirmation; Bitbucket branch writes are paused until the API documents an atomic revision condition.
          - generic [ref=e239]:
            - generic [ref=e240]:
              - generic [ref=e241]: Provider
              - combobox "Provider" [ref=e242]:
                - option "Choose a provider" [selected]
                - option "GitHub"
                - option "Bitbucket Cloud"
            - generic [ref=e243]:
              - generic [ref=e244]: Owner or workspace
              - textbox "Owner or workspace" [ref=e245]
            - generic [ref=e246]:
              - generic [ref=e247]: Repository
              - textbox "Repository" [ref=e248]
            - generic [ref=e249]:
              - generic [ref=e250]: Branch
              - textbox "Branch" [ref=e251]
            - generic [ref=e252]:
              - generic [ref=e253]: Playlist file path
              - textbox "Playlist file path" [ref=e254]
              - generic [ref=e255]: Repository-relative JSON path, such as playlists/ambient.json.
          - generic [ref=e256]:
            - generic [ref=e257]: Provider token
            - textbox "Provider token" [ref=e258]
            - paragraph [ref=e259]: "GitHub: use a fine-grained personal access token restricted to this repository, with Contents read for reading and Contents write for publishing. Bitbucket Cloud: use a repository access token scoped to this repository with Repository Read. Blend currently reads and reviews Bitbucket playlists but pauses branch writes because the documented API does not guarantee atomic compare-and-set."
            - generic [ref=e260] [cursor=pointer]:
              - checkbox "Remember on this device" [ref=e261]
              - generic [ref=e262]: Remember on this device
            - paragraph [ref=e263]: By default, the token stays in memory for this app session. Remembering it saves a provider-tagged token in browser storage on Blend's origin, where JavaScript running on this origin can read it. Blend keeps its consented analytics script and remembered credentials mutually exclusive across open Blend tabs; if analytics is active, this connection stays session-only. This is not a secure vault. Disconnect clears the in-memory token. Forget credential also deletes the saved browser copy, but does not revoke the provider token.
          - generic [ref=e264]:
            - button "Connect and verify access" [ref=e265] [cursor=pointer]
            - button "Disconnect" [disabled] [ref=e266]
            - button "Forget credential" [disabled] [ref=e267]
          - paragraph [ref=e268]:
            - text: "Token setup and revocation:"
            - link "GitHub fine-grained tokens" [ref=e269]:
              - /url: https://github.com/settings/personal-access-tokens
            - text: ;
            - link "create a Bitbucket repository access token" [ref=e270]:
              - /url: https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository-access-token/
            - text: ;
            - link "revoke a Bitbucket repository access token" [ref=e271]:
              - /url: https://support.atlassian.com/bitbucket-cloud/docs/revoke-a-repository-access-token/
            - text: .
          - status [ref=e272]: Enter repository details and connect to verify access. No provider request runs during app startup.
          - generic [ref=e273]:
            - button "Read remote playlist" [disabled] [ref=e274]
            - button "Review local playlist for publishing" [disabled] [ref=e275]
      - generic [ref=e276]:
        - generic [ref=e277]:
          - generic [ref=e278]: "Playlist volume:"
          - slider "Playlist volume:" [ref=e279]: "1"
          - generic [ref=e280]: 100%
        - generic [ref=e281]:
          - generic [ref=e282]: "Slideshow volume:"
          - slider "Slideshow volume:" [ref=e283]: "0.65"
          - generic [ref=e284]: 65%
  - generic [ref=e285]:
    - alert [ref=e286]:
      - generic [ref=e287]: Changes are not saved yet. Retry or export a backup before closing.
      - button "Retry" [ref=e288] [cursor=pointer]
      - button "Export Backup" [ref=e289] [cursor=pointer]
    - alert [ref=e290]:
      - generic [ref=e291]: Selected 3; accepted 3; remaining 0. Added 3; already in library 0; skipped 0. Blend could not save the selected media in browser storage. The files are available for this session only; keep the originals and select them again after reload. Use Retry in the save status to try again.
  - text: ▶
```

# Test source

```ts
  451 |   console.log(`issue15-thumbnail-canvas-measurement=${JSON.stringify(profile)}`);
  452 |   testInfo.annotations.push({ type: 'issue15-thumbnail-canvas-measurement', description: JSON.stringify(profile) });
  453 |   await testInfo.attach('issue15-thumbnail-canvas-measurement.json', {
  454 |     body: Buffer.from(JSON.stringify(profile, null, 2)),
  455 |     contentType: 'application/json'
  456 |   });
  457 | });
  458 | 
  459 | test('a canvas failure releases queue capacity and preserves imported rows and playback', async ({ page, browserName }) => {
  460 |   await bootThumbnailApp(page);
  461 |   const browserErrors = [];
  462 |   const handledPersistenceErrors = [];
  463 |   page.on('pageerror', error => browserErrors.push(error.message));
  464 |   page.on('console', message => {
  465 |     if (message.type() !== 'error') return;
  466 |     const text = message.text();
  467 |     if (/\[ERROR\] save failed \{operation: experience_snapshot_write, errorName: UnknownError\}/.test(text)) {
  468 |       handledPersistenceErrors.push(text);
  469 |       return;
  470 |     }
  471 |     browserErrors.push(text);
  472 |   });
  473 | 
  474 |   await page.evaluate(() => {
  475 |     const originalCreateElement = document.createElement;
  476 |     window.__thumbnailObjectUrls.length = 0;
  477 |     window.__thumbnailQueueFault = { drawCalls: 0, toBlobCalls: 0, failures: 0, failSize: null, sourceSizes: [] };
  478 |     document.createElement = function (tagName, ...args) {
  479 |       const element = originalCreateElement.call(this, tagName, ...args);
  480 |       if (String(tagName).toLowerCase() !== 'canvas') return element;
  481 |       element.getContext = function () {
  482 |         return {
  483 |           drawImage(...drawArgs) {
  484 |             const source = String(drawArgs[0]?.src || '');
  485 |             const fault = window.__thumbnailQueueFault;
  486 |             const record = window.__thumbnailObjectUrls.find(item => item.url === source);
  487 |             const size = Number(record?.size || 0);
  488 |             fault.drawCalls += 1;
  489 |             fault.sourceSizes.push(size);
  490 |             if (fault.failSize === null) fault.failSize = size;
  491 |             if (size === fault.failSize) {
  492 |               fault.failures += 1;
  493 |               throw new DOMException('synthetic-queue-canvas-detail', 'SecurityError');
  494 |             }
  495 |           }
  496 |         };
  497 |       };
  498 |       const nativeToBlob = element.toBlob.bind(element);
  499 |       element.toBlob = (callback, ...options) => {
  500 |         window.__thumbnailQueueFault.toBlobCalls += 1;
  501 |         nativeToBlob(blob => callback(blob), ...options);
  502 |       };
  503 |       return element;
  504 |     };
  505 |     window.__thumbnailQueueFault.restore = () => { document.createElement = originalCreateElement; };
  506 |   });
  507 | 
  508 |   const files = [
  509 |     { name: 'preview-fail-first.png', mimeType: 'image/png', buffer: IMAGE_FIXTURES[0] },
  510 |     { name: 'preview-next.jpg', mimeType: 'image/jpeg', buffer: IMAGE_FIXTURES[1] },
  511 |     { name: 'preview-last.jpeg', mimeType: 'image/jpeg', buffer: IMAGE_FIXTURES[2] }
  512 |   ];
  513 |   const names = files.map(file => file.name);
  514 |   const app = await addImages(page, files);
  515 |   const expectedSourceSizes = IMAGE_FIXTURES.map(buffer => buffer.byteLength);
  516 |   await page.waitForFunction(() => {
  517 |     const queue = window.__BLEND_TEST_HOOKS__?.thumbnails?.queueStatus?.();
  518 |     const sourceSizes = new Set(window.__thumbnailQueueFault?.sourceSizes || []);
  519 |     return sourceSizes.size >= 3 && window.__thumbnailQueueFault?.failures >= 1 && queue?.active === 0 && queue?.pending === 0;
  520 |   }, null, { timeout: 15000 });
  521 |   await page.evaluate(() => window.__thumbnailQueueFault?.restore?.());
  522 | 
  523 |   const outcomes = await page.evaluate(expectedNames => expectedNames.map(name => {
  524 |     const card = Array.from(document.querySelectorAll('#library-grid .lib-card'))
  525 |       .find(element => element.getAttribute('aria-label')?.startsWith(`${name},`));
  526 |     const thumb = card?.querySelector('.thumb');
  527 |     return {
  528 |       name,
  529 |       ariaLabel: card?.getAttribute('aria-label') || '',
  530 |       fallbackText: thumb?.textContent || '',
  531 |       hasPreview: Boolean(thumb?.querySelector('img'))
  532 |     };
  533 |   }), names);
  534 |   const thumbnailDebug = await page.evaluate(() => ({
  535 |     fault: window.__thumbnailQueueFault,
  536 |     urls: window.__thumbnailObjectUrls,
  537 |     thumbs: Array.from(document.querySelectorAll('#library-grid .lib-card')).map(card => ({
  538 |       label: card.getAttribute('aria-label'),
  539 |       state: card.querySelector('.thumb')?.dataset,
  540 |       text: card.querySelector('.thumb')?.textContent || ''
  541 |     })),
  542 |     thumbnailLogs: JSON.parse(window.Blend.log.exportJson())
  543 |       .filter(entry => /thumb/i.test(entry.message || ''))
  544 |       .map(entry => ({ message: entry.message, args: entry.args }))
  545 |   }));
  546 |   const injectedFailureIndex = IMAGE_FIXTURES.findIndex(buffer => buffer.byteLength === thumbnailDebug.fault.failSize);
  547 |   const failedName = names[injectedFailureIndex];
  548 |   const failedOutcome = outcomes.find(outcome => outcome.name === failedName);
  549 |   expect(thumbnailDebug.fault.drawCalls).toBeGreaterThanOrEqual(3);
  550 |   expect(thumbnailDebug.fault.failures).toBeGreaterThanOrEqual(1);
> 551 |   expect(thumbnailDebug.fault.toBlobCalls).toBe(2);
      |                                            ^ Error: expect(received).toBe(expected) // Object.is equality
  552 |   expect(outcomes).toHaveLength(3);
  553 |   expect(outcomes.every(outcome => outcome.hasPreview || outcome.fallbackText === '🖼️')).toBe(true);
  554 |   expect(failedOutcome?.hasPreview).toBe(false);
  555 |   expect(failedOutcome?.fallbackText).toBe('🖼️');
  556 |   expect(failedOutcome?.ariaLabel).toContain(failedName);
  557 |   if (browserName !== 'webkit') expect(outcomes.filter(outcome => outcome.hasPreview)).toHaveLength(2);
  558 |   for (const outcome of outcomes) {
  559 |     const name = outcome.name;
  560 |     expect(outcome.ariaLabel).toContain(name);
  561 |     if (!outcome.hasPreview) {
  562 |       expect(outcome.fallbackText).toBe('🖼️');
  563 |       continue;
  564 |     }
  565 |     const card = page.locator('#library-grid .lib-card').filter({ hasText: name }).first();
  566 |     await expect(card).toHaveAttribute('aria-label', new RegExp(name.replaceAll('.', '\\.')));
  567 |     await expect(card.locator('.thumb img')).toHaveCount(1);
  568 |   }
  569 | 
  570 |   await page.waitForFunction(sourceSizes => {
  571 |     const sources = window.__thumbnailObjectUrls.filter(record => sourceSizes.includes(record.size));
  572 |     return sources.length >= 3 && sources.every(record => record.revoked);
  573 |   }, expectedSourceSizes, { timeout: 5000 });
  574 |   const urlState = await page.evaluate(() => window.__thumbnailObjectUrls);
  575 |   const sourceImageUrls = urlState.filter(record => expectedSourceSizes.includes(record.size));
  576 |   const thumbnailUrls = urlState.filter(record => record.type === 'image/jpeg' && !expectedSourceSizes.includes(record.size));
  577 |   expect(sourceImageUrls.length).toBeGreaterThanOrEqual(3);
  578 |   expect(sourceImageUrls.every(record => record.revoked)).toBe(true);
  579 |   if (browserName !== 'webkit') expect(thumbnailUrls.length).toBeGreaterThanOrEqual(2);
  580 | 
  581 |   const saveSucceeded = await page.evaluate(() => window.Blend.saveStateNow());
  582 |   const inMemoryLibraryNames = await page.evaluate(() => Array.from(window.Blend.state.library.values(), item => item.name));
  583 |   expect(inMemoryLibraryNames).toEqual(expect.arrayContaining(names));
  584 |   if (saveSucceeded) {
  585 |     const persistedLibraryNames = await readPersistedLibraryNames(page);
  586 |     expect(persistedLibraryNames).toEqual(expect.arrayContaining(names));
  587 |   } else {
  588 |     expect(browserName).toBe('webkit');
  589 |     test.info().annotations.push({
  590 |       type: 'browser persistence limitation',
  591 |       description: 'WebKit returned an IndexedDB snapshot UnknownError; in-memory rows and playback remain available.'
  592 |     });
  593 |   }
  594 | 
  595 |   await app.selectLibraryItemsByNames([failedName]);
  596 |   await app.addSelectedLibraryToList('slideshow', 1);
  597 |   await app.startPlayback();
  598 |   const playback = await page.evaluate(() => ({
  599 |     playing: Boolean(window.Blend?.state?.runtime?.isPlaying),
  600 |     slideshowLength: window.Blend?.state?.slideshow?.length || 0,
  601 |     imageSource: document.querySelector('#slideshow-layer img[src]')?.src || '',
  602 |     sourceSize: window.__thumbnailObjectUrls.find(record => record.url === document.querySelector('#slideshow-layer img[src]')?.src)?.size || 0
  603 |   }));
  604 |   expect(playback.playing).toBe(true);
  605 |   expect(playback.slideshowLength).toBe(1);
  606 |   expect(playback.imageSource).toMatch(/^blob:/);
  607 |   expect(playback.sourceSize).toBe(expectedSourceSizes[injectedFailureIndex]);
  608 | 
  609 |   const logs = await page.evaluate(() => window.Blend.log.exportJson());
  610 |   expect(logs).not.toContain('synthetic-queue-canvas-detail');
  611 |   if (browserName === 'webkit' && !saveSucceeded) expect(handledPersistenceErrors.length).toBeGreaterThan(0);
  612 |   expect(browserErrors).toEqual([]);
  613 | });
  614 | });
  615 | 
```