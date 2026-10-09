import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { decompressExperience } from '../../url-share.js';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const BEARER_MARKER = 'issue01-e2e-synthetic-bearer-94a7';
const PORTABLE_REFERENCE = 'supabase://private-media/private/video.mp4';
const PUBLIC_URL = 'https://cdn.example.test/media/public.mp4?version=3';
const PUBLIC_STORAGE_REFERENCE = 'supabase://public/codex-policy-check/public-video.mp4';
const UNUSED_PRIVATE_STORAGE_REFERENCE = 'supabase://private-media/codex-policy-check/unused-private-video.mp4';
const PRIVATE_POLICY_WARNING = 'Private media access could not be verified. Contact the project owner before sharing.';
const PATH_OMISSION_NOTICE = 'Local file path details were omitted from this export for privacy. Media references and the saved library were not changed.';
const PATH_CREDENTIAL_MARKER = 'issue05-e2e-synthetic-credential-marker';
const ABSOLUTE_PATH_SENTINELS = [
  'C:\\Users\\blend-issue05\\private\\windows-secret-05.mp4',
  '\\\\blend-server-issue05\\private-share\\unc-secret-05.mp4',
  '/home/blend-issue05/private/posix-secret-05.mp4',
  '\\blend-issue05\\rooted-secret-05.mp4'
];
const SIGNED_URL = `https://fixture.invalid/storage/v1/object/sign/private-media/private/video.mp4?token=${BEARER_MARKER}&expires=4102444800`;

async function boot(page) {
  await page.addInitScript(({ fixtureOrigin }) => {
    localStorage.setItem('blend-welcome-v4', '1');
    localStorage.setItem('blend-install-banner-hidden-v4', '1');
    localStorage.setItem('blend-analytics-consent-v1', '0');
    const key = 'blend-runtime-config-v1';
    try {
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({
        ...existing,
        SUPABASE_URL: fixtureOrigin,
        SUPABASE_MEDIA_BUCKET: 'media',
        SUPABASE_PUBLIC_BUCKETS: 'public'
      }));
    } catch (_) {}
  }, { fixtureOrigin: FIXTURE_ORIGIN });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.Blend?.state);
}

async function seedPrivateAndPublicRecords(page, {
  expiredPrivateUrl = false,
  includePrivate = true,
  includePublic = true,
  includeUnused = false
} = {}) {
  await page.evaluate(({ signedUrl, publicUrl, portableReference, pathSentinels, pathCredentialMarker, expiredPrivateUrl, includePrivate, includePublic, includeUnused }) => {
    const blend = window.Blend;
    const state = blend.state;
    const privateMetadata = {
      sourceUrl: signedUrl,
      storageReference: portableReference,
      storageBucket: 'private-media',
      storagePath: 'private/video.mp4',
      signedUrlExpiresAt: expiredPrivateUrl ? Date.now() - 60_000 : 4102444800000,
      access_token: 'issue01-e2e-synthetic-bearer-94a7',
      nestedAuth: { refresh_token: 'issue01-e2e-synthetic-bearer-94a7' },
      safeLabel: 'Synthetic imported media label',
      relativePath: 'media/private/video.mp4',
      importedDetails: {
        localA: pathSentinels[0],
        nested: [{ localB: pathSentinels[1] }, { localC: pathSentinels[2] }],
        rootedWindowsPath: pathSentinels[3],
        access_token: pathCredentialMarker
      }
    };
    state.library.clear();
    if (includePrivate) {
      state.library.set('private-video', {
        id: 'private-video', name: 'Private video.mp4', type: 'video', size: 1200,
        duration: 12, addedAt: '2026-09-27T00:00:00.000Z', stale: false,
        pathHint: portableReference, sourceUrl: signedUrl, metadata: { ...privateMetadata }
      });
    }
    if (includePublic) {
      state.library.set('public-video', {
        id: 'public-video', name: 'Public video.mp4', type: 'video', size: 2400,
        duration: 24, addedAt: '2026-09-27T00:00:00.000Z', stale: false,
        pathHint: publicUrl, sourceUrl: publicUrl,
        metadata: { sourceUrl: publicUrl, license: 'fixture-public' }
      });
    }
    if (includeUnused) {
      state.library.set('unused-secret-id-02', {
        id: 'unused-secret-id-02', name: 'Unused private media 02', type: 'video', size: 3600,
        duration: 36, addedAt: '2026-09-27T00:00:00.000Z', stale: false,
        pathHint: 'C:/private/unused-directory/unused-secret-02.mp4',
        sourceUrl: 'https://private.example.test/unused-secret-url-02.mp4',
        metadata: {
          marker: 'unused-secret-metadata-02',
          privatePath: 'C:\\private\\unused-directory\\unused-secret-02.mp4'
        }
      });
    }
    state.playlist = [
      ...(includePrivate ? [{ id: 'private-video', sourceUrl: signedUrl, metadata: { ...privateMetadata }, available: true }] : []),
      ...(includePublic ? [
        { id: 'public-video', sourceUrl: publicUrl, metadata: { sourceUrl: publicUrl }, available: true },
        { id: 'public-video', sourceUrl: publicUrl, metadata: { sourceUrl: publicUrl }, available: true }
      ] : [])
    ];
    state.slideshow = includePublic
      ? [{ id: 'public-video', sourceUrl: publicUrl, metadata: { sourceUrl: publicUrl }, available: true }]
      : [];
    state.projectName = 'Private Media Export E2E';
    state.activeExperienceId = 'exp-private-media-export-e2e';
    localStorage.setItem('blend-active-experience-id', state.activeExperienceId);
    state.ui.activeList = 'playlist';
    blend.renderLibrary();
    blend.renderListEditor();
  }, {
    signedUrl: SIGNED_URL,
    publicUrl: PUBLIC_URL,
    portableReference: PORTABLE_REFERENCE,
    pathSentinels: ABSOLUTE_PATH_SENTINELS,
    pathCredentialMarker: PATH_CREDENTIAL_MARKER,
    expiredPrivateUrl,
    includePrivate,
    includePublic,
    includeUnused
  });
}

async function seedPublicSupabaseOnly(page) {
  await page.evaluate(({ publicReference, unusedPrivateReference, pathSentinels, pathCredentialMarker }) => {
    const blend = window.Blend;
    const state = blend.state;
    state.library.clear();
    state.library.set('public-video', {
      id: 'public-video', name: 'Public video.mp4', type: 'video', size: 2400,
      duration: 24, addedAt: '2026-09-27T00:00:00.000Z', stale: false,
      pathHint: publicReference,
      sourceUrl: publicReference,
      metadata: {
        storageReference: publicReference,
        storageBucket: 'public',
        storagePath: 'codex-policy-check/public-video.mp4',
        safeLabel: 'Public project label',
        relativePath: 'media/public-video.mp4',
        importedDetails: {
          localA: pathSentinels[0],
          nested: [{ localB: pathSentinels[1] }, { localC: pathSentinels[2] }],
          rootedWindowsPath: pathSentinels[3],
          access_token: pathCredentialMarker
        }
      }
    });
    state.library.set('unused-private-video', {
      id: 'unused-private-video', name: 'Unused private video.mp4', type: 'video', size: 1200,
      duration: 12, addedAt: '2026-09-27T00:00:00.000Z', stale: false,
      pathHint: unusedPrivateReference,
      sourceUrl: unusedPrivateReference,
      metadata: {
        storageReference: unusedPrivateReference,
        storageBucket: 'private-media',
        storagePath: 'codex-policy-check/unused-private-video.mp4'
      }
    });
    state.playlist = [{
      id: 'public-video', path: publicReference, sourceUrl: publicReference,
      metadata: { storageReference: publicReference, storageBucket: 'public', storagePath: 'codex-policy-check/public-video.mp4' },
      available: true
    }];
    state.slideshow = [];
    state.projectName = 'Public Supabase Share E2E';
    state.activeExperienceId = 'exp-public-supabase-share-e2e';
    localStorage.setItem('blend-active-experience-id', state.activeExperienceId);
    state.ui.activeList = 'playlist';
    blend.renderLibrary();
    blend.renderListEditor();
  }, {
    publicReference: PUBLIC_STORAGE_REFERENCE,
    unusedPrivateReference: UNUSED_PRIVATE_STORAGE_REFERENCE,
    pathSentinels: ABSOLUTE_PATH_SENTINELS,
    pathCredentialMarker: PATH_CREDENTIAL_MARKER
  });
}

async function snapshotUserState(page) {
  return page.evaluate(() => {
    const state = window.Blend.state;
    return {
      projectName: state.projectName,
      activeExperienceId: state.activeExperienceId,
      activeList: state.ui.activeList,
      playlist: state.playlist.map(ref => ({ id: ref.id, sourceUrl: ref.sourceUrl, available: ref.available, metadata: structuredClone(ref.metadata || {}) })),
      slideshow: state.slideshow.map(ref => ({ id: ref.id, sourceUrl: ref.sourceUrl, available: ref.available, metadata: structuredClone(ref.metadata || {}) })),
      listSelection: Array.from(state.ui.listSelection || []),
      listSelectionAnchorId: state.ui.listSelectionAnchorId,
      library: Array.from(state.library.entries(), ([id, item]) => [id, {
        pathHint: item.pathHint,
        sourceUrl: item.sourceUrl,
        metadata: structuredClone(item.metadata || {})
      }]),
      libraryIds: Array.from(state.library.keys()),
      playlistIndex: state.runtime.playlistIndex,
      slideshowIndex: state.runtime.slideshowIndex,
      isPlaying: state.runtime.isPlaying,
      transport: window.Blend.transport
    };
  });
}

function stringLeaves(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(entry => stringLeaves(entry, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(entry => stringLeaves(entry, result));
  return result;
}

function assertNoBearerData(value) {
  const leaves = stringLeaves(value);
  expect(leaves.join('\n')).not.toContain(BEARER_MARKER);
  expect(leaves.join('\n')).not.toContain(PATH_CREDENTIAL_MARKER);
  expect(leaves.join('\n')).not.toMatch(/[?&](?:access_token|refresh_token|token|signature|sig)=/i);
}

function assertNoPathSentinels(value) {
  const leaves = stringLeaves(value);
  for (const sentinel of ABSOLUTE_PATH_SENTINELS) {
    expect(leaves.join('\n')).not.toContain(sentinel);
  }
}

test('JSON export preserves private references while compressed sharing blocks them until provider verification', async ({ page }, testInfo) => {
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.text()));
  await boot(page);
  await seedPrivateAndPublicRecords(page, { includeUnused: true });

  const config = page.locator('#config-panel');
  if (!(await config.evaluate(node => node.classList.contains('open')))) {
    await page.locator('#config-gear').click();
    await expect(config).toHaveClass(/open/);
  }
  const beforeExperienceExport = await snapshotUserState(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#experience-export').click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('private-media-experience.json');
  await download.saveAs(downloadPath);
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'));

  expect(exported.schema).toBe('player.blend.experience.v2');
  assertNoBearerData(exported);
  assertNoPathSentinels(exported);
  expect(await snapshotUserState(page)).toEqual(beforeExperienceExport);
  await expect(page.locator('#toast-container .toast[role="status"]').filter({ hasText: PATH_OMISSION_NOTICE }).last()).toHaveText(PATH_OMISSION_NOTICE);
  expect(exported.library.items.some(item => item.id === 'unused-secret-id-02')).toBeTruthy();
  const exportedPrivate = exported.library.items.find(item => item.id === 'private-video');
  expect(exportedPrivate.path).toBe(PORTABLE_REFERENCE);
  expect(exportedPrivate.fullPath).toBe(PORTABLE_REFERENCE);
  expect(exportedPrivate.sourceUrl).toBeUndefined();
  expect(exportedPrivate.metadata.sourceUrl).toBeUndefined();
  expect(exportedPrivate.metadata.access_token).toBeUndefined();
  expect(exportedPrivate.metadata.storageReference).toBe(PORTABLE_REFERENCE);
  expect(exportedPrivate.metadata.storageBucket).toBe('private-media');
  expect(exportedPrivate.metadata.storagePath).toBe('private/video.mp4');
  expect(exportedPrivate.metadata.signedUrlExpiresAt).toBe(4102444800000);
  expect(exportedPrivate.metadata.safeLabel).toBe('Synthetic imported media label');
  expect(exportedPrivate.metadata.relativePath).toBe('media/private/video.mp4');
  const exportedPublic = exported.library.items.find(item => item.id === 'public-video');
  expect(exportedPublic.path).toBe(PUBLIC_URL);
  expect(exportedPublic.sourceUrl).toBe(PUBLIC_URL);

  const beforeLibraryExport = await snapshotUserState(page);
  const fullLibraryDownloadPromise = page.waitForEvent('download');
  await page.locator('#list-export').click();
  await page.getByRole('menuitem', { name: 'Export Media Library JSON' }).click();
  const fullLibraryDownload = await fullLibraryDownloadPromise;
  const fullLibraryPath = testInfo.outputPath('private-media-library.json');
  await fullLibraryDownload.saveAs(fullLibraryPath);
  const fullLibrary = JSON.parse(await readFile(fullLibraryPath, 'utf8'));
  expect(fullLibrary.schema).toBe('player.blend.library.v1');
  expect(fullLibrary.items.some(item => item.id === 'unused-secret-id-02')).toBeTruthy();
  assertNoBearerData(fullLibrary);
  assertNoPathSentinels(fullLibrary);
  expect(await snapshotUserState(page)).toEqual(beforeLibraryExport);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: FIXTURE_ORIGIN });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const shareTrigger = page.locator('#experience-share-url');
  const beforeShare = await snapshotUserState(page);
  await shareTrigger.click();
  const toast = page.locator('#toast-container .toast[role="alert"]');
  await expect(toast).toHaveText(PRIVATE_POLICY_WARNING, { timeout: 7000 });
  await expect(page.locator('#toast-container .toast[role="status"]').filter({ hasText: PATH_OMISSION_NOTICE }).last()).toHaveText(PATH_OMISSION_NOTICE);
  const shareInput = page.locator('#url-share-url-input');
  await expect(page.locator('#url-share-modal')).not.toBeVisible();
  await expect(shareInput).toHaveValue('');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
  expect(await snapshotUserState(page)).toEqual(beforeShare);
  await expect(shareTrigger).toBeEnabled();
  expect(consoleMessages.join('\n')).not.toContain(BEARER_MARKER);
  expect(consoleMessages.join('\n')).not.toContain(PATH_CREDENTIAL_MARKER);
  for (const sentinel of ABSOLUTE_PATH_SENTINELS) expect(consoleMessages.join('\n')).not.toContain(sentinel);
  expect(consoleMessages.join('\n')).not.toContain('unused-secret-id-02');
  expect(consoleMessages.join('\n')).not.toContain('unused-secret-url-02');
  expect(consoleMessages.join('\n')).not.toMatch(/[?&](?:access_token|refresh_token|token|signature|sig)=/i);
  expect(consoleMessages.join('\n')).not.toContain('private/video.mp4');
});

test('share disclosure stays readable across viewports and clipboard failure preserves the link', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push(message.text()));
  await boot(page);
  await seedPublicSupabaseOnly(page);
  const config = page.locator('#config-panel');
  if (!(await config.evaluate(node => node.classList.contains('open')))) {
    await page.locator('#config-gear').click();
    await expect(config).toHaveClass(/open/);
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: FIXTURE_ORIGIN });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const sourceStateBeforeShare = await snapshotUserState(page);

  for (const width of [320, 768, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    const shareTrigger = page.locator('#experience-share-url');
    if (width === 320) {
      await shareTrigger.focus();
      await page.keyboard.press('Enter');
    } else {
      await shareTrigger.click();
    }
    const dialog = page.getByRole('dialog', { name: 'Share Experience via URL' });
    const disclosure = page.locator('#url-share-disclosure');
    const omissionNote = page.locator('#url-share-path-omission');
    await expect(dialog).toBeVisible();
    await expect(omissionNote).toBeVisible();
    await expect(omissionNote).toHaveAttribute('role', 'status');
    await expect(omissionNote).toHaveText(PATH_OMISSION_NOTICE);
    await expect(disclosure).toHaveText(
      'This link includes media referenced by the playlist and slideshow. Unused library items are not included.'
    );
    if (width === 320) {
      const sharedValue = new URL(await page.locator('#url-share-url-input').inputValue());
      const shared = await decompressExperience(sharedValue.searchParams.get('experience'));
      expect(shared.library.items.map(item => item.id)).toEqual(['public-video']);
      expect(shared.library.items[0].metadata.storageReference).toBe(PUBLIC_STORAGE_REFERENCE);
      expect(shared.library.items[0].metadata.safeLabel).toBe('Public project label');
      expect(shared.library.items[0].metadata.relativePath).toBe('media/public-video.mp4');
      assertNoPathSentinels(shared);
      assertNoBearerData(shared);
      expect(JSON.stringify(shared)).not.toContain(UNUSED_PRIVATE_STORAGE_REFERENCE);
    }
    const layout = await page.evaluate(() => {
      const dialogRect = document.querySelector('#url-share-modal').getBoundingClientRect();
      const disclosureNode = document.querySelector('#url-share-disclosure');
      const disclosureRect = disclosureNode.getBoundingClientRect();
      const omissionNode = document.querySelector('#url-share-path-omission');
      const omissionRect = omissionNode.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        dialogLeft: dialogRect.left,
        dialogRight: dialogRect.right,
        disclosureLeft: disclosureRect.left,
        disclosureRight: disclosureRect.right,
        disclosureClientWidth: disclosureNode.clientWidth,
        disclosureScrollWidth: disclosureNode.scrollWidth,
        omissionRight: omissionRect.right,
        omissionClientWidth: omissionNode.clientWidth,
        omissionScrollWidth: omissionNode.scrollWidth,
        disclosureLines: (() => {
          const range = document.createRange();
          range.selectNodeContents(disclosureNode);
          return range.getClientRects().length;
        })(),
        omissionLines: (() => {
          const range = document.createRange();
          range.selectNodeContents(omissionNode);
          return range.getClientRects().length;
        })(),
        focusInsideDialog: document.querySelector('#url-share-modal').contains(document.activeElement)
      };
    });
    expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(layout.dialogRight).toBeLessThanOrEqual(width);
    expect(layout.disclosureLeft).toBeGreaterThanOrEqual(layout.dialogLeft);
    expect(layout.disclosureRight).toBeLessThanOrEqual(layout.dialogRight);
    expect(layout.disclosureScrollWidth).toBeLessThanOrEqual(layout.disclosureClientWidth + 1);
    expect(layout.disclosureLines).toBeGreaterThanOrEqual(1);
    if (width === 320) expect(layout.disclosureLines).toBeGreaterThan(1);
    expect(layout.omissionRight).toBeLessThanOrEqual(layout.dialogRight);
    expect(layout.omissionScrollWidth).toBeLessThanOrEqual(layout.omissionClientWidth + 1);
    expect(layout.omissionLines).toBeGreaterThanOrEqual(1);
    if (width === 320) expect(layout.omissionLines).toBeGreaterThan(1);
    expect(layout.focusInsideDialog).toBeTruthy();
    await expect(page.locator('#url-share-url-input')).toHaveAccessibleName('Share URL');

    if (width === 320) {
      const copyButton = page.locator('#url-share-copy');
      await copyButton.focus();
      await page.keyboard.press('Enter');
      await expect(copyButton).toHaveText('Copied ✓');
      const currentShareUrl = await page.locator('#url-share-url-input').inputValue();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(currentShareUrl);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(shareTrigger).toBeFocused();
      expect(await snapshotUserState(page)).toEqual(sourceStateBeforeShare);
      continue;
    }

    if (width === 768) {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } }
        });
      });
      await page.locator('#url-share-copy').click();
      await expect(page.locator('#url-share-url-input')).toBeFocused();
      const selected = await page.locator('#url-share-url-input').evaluate(input =>
        input.selectionStart === 0 && input.selectionEnd === input.value.length
      );
      expect(selected).toBeTruthy();
      await expect(page.locator('#toast-container')).toContainText('Press Ctrl+C / Cmd+C to copy the URL');
    }

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(shareTrigger).toBeFocused();
    expect(await snapshotUserState(page)).toEqual(sourceStateBeforeShare);
  }

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator('#experience-share-url').click();
  await expect(page.locator('#url-share-disclosure')).toBeVisible();
  await expect(page.locator('#url-share-path-omission')).toBeVisible();
  const zoomLayout = await page.evaluate(() => {
    const dialog = document.querySelector('#url-share-modal').getBoundingClientRect();
    const disclosure = document.querySelector('#url-share-disclosure').getBoundingClientRect();
    return { viewportWidth: innerWidth, dialogLeft: dialog.left, dialogRight: dialog.right, disclosureRight: disclosure.right };
  });
  expect(zoomLayout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(zoomLayout.dialogRight).toBeLessThanOrEqual(zoomLayout.viewportWidth);
  expect(zoomLayout.disclosureRight).toBeLessThanOrEqual(zoomLayout.dialogRight);
  await page.keyboard.press('Escape');
  await expect(page.locator('#experience-share-url')).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });

  const stateBeforeShareFailure = await snapshotUserState(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'CompressionStream', {
      configurable: true,
      value: class {
        constructor() { throw new Error('synthetic-private-error-path-02'); }
      }
    });
  });
  await page.locator('#experience-share-url').click();
  await expect(page.locator('#toast-container')).toContainText(
    'Could not prepare this share link. Your experience is unchanged.'
  );
  await expect(page.locator('#toast-container .toast[role="status"]').filter({ hasText: PATH_OMISSION_NOTICE })).toHaveText(PATH_OMISSION_NOTICE);
  expect(await snapshotUserState(page)).toEqual(stateBeforeShareFailure);
  const storedLog = await page.evaluate(() => localStorage.getItem('blend-debug-log-v1') || '');
  expect(storedLog).toContain('build_url_share');
  expect(storedLog).toContain('unexpected_error');
  expect(storedLog).not.toContain('synthetic-private-error-path-02');

  const logged = consoleMessages.join('\n');
  expect(logged).not.toContain('unused-secret-id-02');
  expect(logged).not.toContain('unused-secret-url-02');
  expect(logged).not.toContain('unused-secret-metadata-02');
  expect(logged).not.toContain('synthetic-private-error-path-02');
  expect(logged).not.toMatch(/[?&](?:access_token|refresh_token|token|signature|sig)=/i);
});

test('missing auth warning stays keyboard accessible and keeps list entries at 320, 768, and 1366 pixels', async ({ context }) => {
  for (const width of [320, 768, 1366]) {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width, height: 900 });
      await boot(page);
      await seedPrivateAndPublicRecords(page, { expiredPrivateUrl: true, includePublic: false });
      const before = await snapshotUserState(page);
      await page.evaluate(() => window.Blend.play());

      const toast = page.locator('#toast-container .toast').filter({ hasText: 'Sign in to access private media.' }).first();
      await expect(toast).toBeVisible({ timeout: 10_000 });
      await expect(toast).toHaveAttribute('role', 'alert');
      const action = toast.getByRole('button', { name: 'Sign in' });
      await expect(action).toBeVisible();
      expect(await action.evaluate(node => node.tabIndex)).toBeGreaterThanOrEqual(0);
      const box = await toast.boundingBox();
      expect(box).toBeTruthy();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(901);
      await action.focus();
      await expect(action).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#supabase-auth-modal')).toBeVisible();

      const after = await snapshotUserState(page);
      expect(after.playlist.map(ref => ref.id)).toEqual(before.playlist.map(ref => ref.id));
      expect(after.slideshow.map(ref => ref.id)).toEqual(before.slideshow.map(ref => ref.id));
      expect(after.libraryIds).toEqual(before.libraryIds);
      expect(after.activeList).toBe(before.activeList);
      expect(after.playlistIndex).toBe(before.playlistIndex);
      expect(after.slideshowIndex).toBe(before.slideshowIndex);
      expect(after.isPlaying).toBe(before.isPlaying);
      await page.locator('#supabase-auth-modal [data-auth-cancel]').click();
    } finally {
      await page.close();
    }
  }
});

