import { expect } from '@playwright/test';

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || '4191');
const FIXTURE_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

export class BlendAppPage {
  constructor(page) {
    this.page = page;
    this.configPanel = page.locator('#config-panel');
    this.configGearButton = page.locator('#config-gear');
    this.playButton = page.locator('#btn-play');
    this.shareButton = page.locator('#btn-share');
    this.experienceSelect = page.locator('#experience-select');
    this.experienceInput = page.locator('#experience-modal-input');
    this.experienceModal = page.locator('#experience-modal');
    this.toastContainer = page.locator('#toast-container');
  }

  async boot(url = '/index.html') {
    await this.page.addInitScript(({ fixtureOrigin }) => {
      localStorage.setItem('blend-welcome-v4', '1');
      localStorage.setItem('blend-install-banner-hidden-v4', '1');
      localStorage.setItem('blend-analytics-consent-v1', '0');
      const runtimeConfigKey = 'blend-runtime-config-v1';
      try {
        const existingRaw = localStorage.getItem(runtimeConfigKey);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        localStorage.setItem(runtimeConfigKey, JSON.stringify({
          ...existing,
          SUPABASE_URL: fixtureOrigin,
          SUPABASE_AUTH_REDIRECT_URL: `${fixtureOrigin}/index.html`,
          SUPABASE_MEDIA_BUCKET: 'media',
          SUPABASE_PUBLIC_BUCKETS: 'public'
        }));
      } catch (_) {}
      try {
        Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
        Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
      } catch (_) {}
    }, { fixtureOrigin: FIXTURE_ORIGIN });
    await this.page.goto(url);
    await this.page.waitForFunction(() => !!window.Blend && !!window.Blend.state);
    await this.page.waitForSelector('#playlist-layer video');
  }

  async openConfig() {
    await this.dismissIpfsOperationModalIfPresent();
    await this.dismissImportSummaryIfPresent();
    if (!(await this.configPanel.evaluate(node => node.classList.contains('open')))) {
      await this.configGearButton.click();
      await expect(this.configPanel).toHaveClass(/open/);
    }
  }

  async closeConfig() {
    if (await this.configPanel.evaluate(node => node.classList.contains('open'))) {
      await this.page.locator('#close-config').click();
      await expect(this.configPanel).not.toHaveClass(/open/);
    }
  }

  async createExperience(name) {
    await this.openConfig();
    await this.page.locator('#experience-new').click();
    await expect(this.experienceModal).toBeVisible();
    await this.experienceInput.fill(name);
    await this.page.locator('#experience-modal-ok').click();
    await this.expectExperienceOption(name, true);
    await expect(this.experienceSelect).toHaveValue(await this.activeExperienceIdByName(name));
  }

  async renameCurrentExperience(name) {
    await this.openConfig();
    await this.page.locator('#experience-rename').click();
    await expect(this.experienceModal).toBeVisible();
    await this.experienceInput.fill(name);
    await this.page.locator('#experience-modal-ok').click();
    await this.expectExperienceOption(name, true);
  }

  async deleteCurrentExperience() {
    await this.openConfig();
    await this.page.locator('#experience-delete').click();
    await expect(this.experienceModal).toBeVisible();
    await this.page.locator('#experience-modal-ok').click();
    await expect(this.experienceModal).not.toBeVisible();
  }

  async switchExperience(name) {
    await this.openConfig();
    const targetId = await this.activeExperienceIdByName(name);
    await this.experienceSelect.selectOption(targetId);
    await this.page.waitForFunction(expectedName => window.Blend?.state?.projectName === expectedName, name);
  }

  async expectExperienceOption(name, present) {
    await this.openConfig();
    await this.page.waitForFunction(
      ({ expectedName, expectedPresent }) => {
        const options = Array.from(document.querySelectorAll('#experience-select option'))
          .map(node => (node.textContent || '').trim());
        return expectedPresent ? options.includes(expectedName) : !options.includes(expectedName);
      },
      { expectedName: name, expectedPresent: present }
    );
  }

  async activeExperienceIdByName(name) {
    const id = await this.page.evaluate(expectedName => {
      const matches = Array.from(document.querySelectorAll('#experience-select option'))
        .find(node => (node.textContent || '').trim() === expectedName);
      return matches?.value || '';
    }, name);
    if (!id) throw new Error(`Could not find experience option: ${name}`);
    return id;
  }

  async importList(which, filePath) {
    await this.openConfig();
    await this.page.locator(`button[data-tab="${which}"]`).click();
    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.page.locator('#list-import').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
    await this.page.waitForFunction(
      key => key === 'playlist'
        ? window.Blend?.state?.playlist?.length > 0
        : window.Blend?.state?.slideshow?.length > 0,
      which
    );
    await this.dismissImportSummaryIfPresent();
  }

  async switchListTab(which) {
    await this.openConfig();
    await this.page.locator(`button[data-tab="${which}"]`).click();
    await this.page.waitForFunction(
      expected => window.Blend?.state?.ui?.activeList === expected,
      which
    );
  }

  async dropListFile(which, { name, text, expectedMinimumCount = 1 }) {
    await this.switchListTab(which);
    const listEditor = this.page.locator('#list-editor');
    await expect(listEditor).toBeVisible();
    const dropDebug = await this.page.evaluate(async ({ filename, content }) => {
      const container = document.querySelector('#list-editor');
      if (!container) throw new Error('List editor not found');
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], filename, { type: 'text/plain' }));
      const eventLike = {
        dataTransfer: transfer,
        preventDefault() {},
        target: container,
        clientY: 0
      };
      let dropError = '';
      if (typeof container.ondragenter === 'function') container.ondragenter(eventLike);
      if (typeof container.ondragover === 'function') container.ondragover(eventLike);
      if (typeof container.ondrop === 'function') {
        try {
          await container.ondrop(eventLike);
        } catch (error) {
          dropError = String(error?.message || error || 'drop_error');
        }
      }
      const state = window.Blend?.state;
      return {
        hasDropHandler: typeof container.ondrop === 'function',
        transferItemCount: transfer.items.length,
        firstItemKind: transfer.items?.[0]?.kind || '',
        dropError,
        activeList: state?.ui?.activeList || '',
        playlistLength: state?.playlist?.length || 0,
        slideshowLength: state?.slideshow?.length || 0,
        toastText: document.querySelector('#toast-container')?.textContent || ''
      };
    }, { filename: name, content: text });
    if (dropDebug?.dropError) {
      throw new Error(`Drop handler failed: ${dropDebug.dropError}`);
    }

    await this.page.waitForFunction(
      ({ key, expectedCount }) => {
        const list = key === 'playlist'
          ? window.Blend?.state?.playlist || []
          : window.Blend?.state?.slideshow || [];
        return list.length >= expectedCount;
      },
      { key: which, expectedCount: expectedMinimumCount },
      { timeout: 15000 }
    ).catch(async () => {
      const snapshot = await this.page.evaluate(key => {
        const state = window.Blend?.state;
        return {
          activeList: state?.ui?.activeList || '',
          playlistLength: state?.playlist?.length || 0,
          slideshowLength: state?.slideshow?.length || 0,
          toastText: document.querySelector('#toast-container')?.textContent || ''
        };
      }, which);
      throw new Error(`Dropped list did not populate ${which}. Drop debug: ${JSON.stringify(dropDebug)} Snapshot: ${JSON.stringify(snapshot)}`);
    });

    await this.dismissImportSummaryIfPresent();
  }

  async exportExperience() {
    await this.openConfig();
    await this.dismissImportSummaryIfPresent();
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.locator('#experience-export').click();
    return downloadPromise;
  }

  async importExperience(filePath) {
    await this.openConfig();
    await this.dismissImportSummaryIfPresent();
    const before = await this.getExperienceNames();
    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.page.locator('#experience-import').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
    await this.page.waitForFunction(
      expectedCount => (window.Blend?.state?.experiences?.length || 0) >= expectedCount,
      before.length + 1
    );
  }

  async getExperienceNames() {
    await this.openConfig();
    return this.page.evaluate(() => Array.from(document.querySelectorAll('#experience-select option'))
      .map(option => (option.textContent || '').trim())
      .filter(Boolean));
  }

  async activeExperienceName() {
    return this.page.evaluate(() => window.Blend?.state?.projectName || '');
  }

  async createExperienceFromInput(rawValue) {
    await this.openConfig();
    const before = await this.getExperienceNames();
    await this.page.locator('#experience-new').click();
    await expect(this.experienceModal).toBeVisible();
    await this.experienceInput.fill(String(rawValue ?? ''));
    await this.page.locator('#experience-modal-ok').click();

    const accepted = await this.page.waitForFunction(
      previousCount => {
        const modal = document.querySelector('#experience-modal');
        const current = document.querySelectorAll('#experience-select option').length;
        if (!modal) return false;
        if (modal.open) return false;
        return current > previousCount;
      },
      before.length,
      { timeout: 2000 }
    ).then(() => true).catch(() => false);

    if (!accepted) {
      return {
        accepted: false,
        before,
        after: await this.getExperienceNames(),
        activeName: await this.activeExperienceName()
      };
    }

    const after = await this.getExperienceNames();
    const createdName = after.find(name => !before.includes(name)) || '';
    return {
      accepted: true,
      before,
      after,
      createdName,
      activeName: await this.activeExperienceName()
    };
  }

  async renameCurrentExperienceFromInput(rawValue) {
    await this.openConfig();
    const before = await this.getExperienceNames();
    const beforeActive = await this.activeExperienceName();
    await this.page.locator('#experience-rename').click();
    await expect(this.experienceModal).toBeVisible();
    await this.experienceInput.fill(String(rawValue ?? ''));
    await this.page.locator('#experience-modal-ok').click();

    const accepted = await this.page.waitForFunction(
      () => {
        const modal = document.querySelector('#experience-modal');
        return !!modal && !modal.open;
      },
      null,
      { timeout: 2000 }
    ).then(() => true).catch(() => false);

    if (!accepted) {
      return {
        accepted: false,
        before,
        after: await this.getExperienceNames(),
        beforeActive,
        afterActive: await this.activeExperienceName()
      };
    }

    const after = await this.getExperienceNames();
    return {
      accepted: true,
      before,
      after,
      beforeActive,
      afterActive: await this.activeExperienceName()
    };
  }

  async addLocalFiles(filePaths) {
    await this.openConfig();
    const expectedNames = (filePaths || []).map(filePath => String(filePath).split(/[\\/]/).pop()).filter(Boolean);
    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.page.locator('#add-files').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePaths);
    await this.page.waitForFunction(
      names => names.every(name => Array.from(window.Blend?.state?.library?.values?.() || []).some(item => item?.name === name)),
      expectedNames
    );
    await expect(this.page.locator('#library-grid')).toHaveAttribute('aria-busy', 'false');
  }

  async clearLibrarySearch() {
    const search = this.page.locator('#library-search');
    await search.fill('');
    await expect(this.page.locator('#library-grid')).toHaveAttribute('aria-busy', 'false');
  }

  async selectLibraryItemsByNames(names) {
    await this.openConfig();
    await this.page.keyboard.up('Control');
    await this.page.keyboard.up('Meta');
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const card = this.page.locator('#library-grid .lib-card', {
        has: this.page.locator('.name', { hasText: name })
      }).first();
      await expect(card).toBeVisible();
      await card.click(index > 0 ? { modifiers: ['ControlOrMeta'] } : {});
    }
  }

  async addSelectedLibraryToList(which, expectedMinimumCount) {
    const buttonId = which === 'playlist' ? '#add-selected-playlist' : '#add-selected-slideshow';
    await this.page.locator(buttonId).click();
    await this.page.waitForFunction(
      ({ key, minCount }) => {
        const list = key === 'playlist'
          ? window.Blend?.state?.playlist || []
          : window.Blend?.state?.slideshow || [];
        return list.length >= minCount;
      },
      { key: which, minCount: expectedMinimumCount }
    );
  }

  async configureIpfsForFixture(kuboEndpoint, gatewayUrl) {
    await this.page.evaluate(({ endpoint, gateway }) => {
      Object.assign(window.Blend.state.settings, {
        storageDefaultBucket: 'media',
        storageSignedUrlTtlSeconds: 1209600,
        privateMediaRequiresAuth: false,
        ipfsEnabled: true,
        ipfsMode: 'kubo',
        ipfsKuboApiEndpoint: endpoint,
        ipfsGatewayUrls: gateway
      });
    }, { endpoint: kuboEndpoint, gateway: gatewayUrl });
  }

  async shareActiveExperienceAndCaptureUrl() {
    await this.closeConfig();
    const shareUrl = await this.page.evaluate(() => {
      const experienceId = window.Blend?.state?.activeExperienceId || '';
      return window.Blend?.buildDeepLinkUrl?.({ experienceId }) || '';
    });
    if (!shareUrl) throw new Error('Could not build deep-link share URL');
    return shareUrl;
  }

  async expectToastToContain(pattern) {
    await expect(this.toastContainer).toContainText(pattern);
  }

  async startPlayback() {
    await this.dismissIpfsOperationModalIfPresent();
    await this.closeConfig();
    await this.playButton.click();
    await this.page.waitForFunction(() => {
      const state = window.Blend?.state;
      if (!state) return false;
      const toastText = (document.querySelector('#toast-container')?.textContent || '').toLowerCase();
      return !!state.runtime?.isPlaying ||
        /press play|no playable media|could not load/i.test(toastText) ||
        !!state.playlist?.[state.runtime?.playlistIndex ?? 0] ||
        !!state.slideshow?.[state.runtime?.slideshowIndex ?? 0];
    }, { timeout: 5000 }).catch(() => {});
  }

  async playbackSummary() {
    return this.page.evaluate(() => {
      const state = window.Blend?.state;
      const playlistCurrent = state?.playlist?.[state?.runtime?.playlistIndex ?? 0] || null;
      const slideshowCurrent = state?.slideshow?.[state?.runtime?.slideshowIndex ?? 0] || null;
      const playlistVideo = document.querySelector('#playlist-layer video[src]');
      const slideshowMedia = document.querySelector('#slideshow-layer img[src], #slideshow-layer video[src]');
      return {
        activeExperienceName: state?.projectName || '',
        isPlaying: !!state?.runtime?.isPlaying,
        playButtonText: document.querySelector('#btn-play')?.textContent || '',
        playlistCurrentSource: playlistCurrent?.sourceUrl || playlistCurrent?.path || '',
        slideshowCurrentSource: slideshowCurrent?.sourceUrl || slideshowCurrent?.path || '',
        playlistElementSrc: playlistVideo?.src || '',
        slideshowElementSrc: slideshowMedia?.src || '',
        slideshowElementTag: slideshowMedia?.tagName || '',
        toastText: document.querySelector('#toast-container')?.textContent || '',
        playlistLength: state?.playlist?.length || 0,
        slideshowLength: state?.slideshow?.length || 0
      };
    });
  }

  async buildShareLinkForExperience(name) {
    return this.page.evaluate(expectedName => {
      const exp = (window.Blend?.state?.experiences || []).find(record => record?.name === expectedName);
      if (!exp?.id) return '';
      return window.Blend.buildDeepLinkUrl({ experienceId: exp.id });
    }, name);
  }

  async dismissImportSummaryIfPresent() {
    const dialog = this.page.locator('#import-summary-modal');
    if (await dialog.count()) {
      const closeButton = dialog.locator('[data-close]');
      if (await closeButton.count()) {
        await closeButton.click();
      } else {
        await this.page.keyboard.press('Escape');
      }
      await expect(dialog).toHaveCount(0);
    }
  }

  async dismissIpfsOperationModalIfPresent() {
    const dialog = this.page.locator('#ipfs-operation-modal');
    if (!(await dialog.count())) return;

    const closeButton = dialog.locator('[data-close]');
    const cancelButton = dialog.locator('[data-cancel]');
    const closeVisible = await closeButton.isVisible().catch(() => false);
    if (closeVisible) {
      await closeButton.click();
      await expect(dialog).toHaveCount(0);
      return;
    }

    const cancelVisible = await cancelButton.isVisible().catch(() => false);
    if (cancelVisible) {
      await cancelButton.click();
      await expect(dialog).toHaveCount(0);
      return;
    }

    await this.page.keyboard.press('Escape').catch(() => {});
    await dialog.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  }
}

export function expectSourceMatch(actualSource, expectedSources, label) {
  const normalizedActual = String(actualSource || '').trim();
  const normalizedExpected = (expectedSources || []).map(item => String(item || '').trim()).filter(Boolean);
  const matched = normalizedExpected.some(source => normalizedActual.includes(source));
  expect(
    matched,
    `${label} source mismatch. Actual: "${normalizedActual}". Expected one of: ${normalizedExpected.join(', ')}`
  ).toBeTruthy();
}
