import { test, expect } from '@playwright/test';
import { BlendAppPage } from './support/blend-app-page.mjs';
import { formatSanitizedProviderDiagnostic } from '../integration/git-playlist-provider-diagnostics.js';

const NOT_RUN_MESSAGE = 'Provider verification was not run. Local playlist edits remain saved; inspect the disposable repository before retrying a publish.';
const FIXTURE_PATH = 'blend-smoke/playlist.json';
const PRIVATE_REPOSITORY_PREFIX = 'blend-smoke-';
test.describe.configure({ retries: 0 });

function githubConfig() {
  const owner = process.env.BLEND_GITHUB_SMOKE_OWNER || '';
  const repository = process.env.BLEND_GITHUB_SMOKE_REPOSITORY || '';
  const branch = process.env.BLEND_GITHUB_SMOKE_BRANCH || 'main';
  const token = process.env.BLEND_GITHUB_SMOKE_TOKEN || '';
  const confirmation = process.env.BLEND_GITHUB_SMOKE_CONFIRM || '';
  const expectedConfirmation = `I_CONFIRM_DISPOSABLE_PRIVATE_REPOSITORY:${owner}/${repository}`;
  const repositoryIsDisposable = repository.toLowerCase().startsWith(PRIVATE_REPOSITORY_PREFIX);
  return {
    ready: !!token && !!owner && repositoryIsDisposable && confirmation === expectedConfirmation,
    settings: { provider: 'github', owner, repository, branch, path: FIXTURE_PATH },
    token
  };
}

function bitbucketConfig() {
  const owner = process.env.BLEND_BITBUCKET_SMOKE_WORKSPACE || '';
  const repository = process.env.BLEND_BITBUCKET_SMOKE_REPOSITORY || '';
  const branch = process.env.BLEND_BITBUCKET_SMOKE_BRANCH || 'main';
  const token = process.env.BLEND_BITBUCKET_SMOKE_TOKEN || '';
  const confirmation = process.env.BLEND_BITBUCKET_SMOKE_CONFIRM || '';
  const expectedConfirmation = `I_CONFIRM_DISPOSABLE_PRIVATE_REPOSITORY:${owner}/${repository}`;
  const repositoryIsDisposable = repository.toLowerCase().startsWith(PRIVATE_REPOSITORY_PREFIX);
  return {
    ready: !!token && !!owner && repositoryIsDisposable && confirmation === expectedConfirmation,
    settings: { provider: 'bitbucket', owner, repository, branch, path: FIXTURE_PATH },
    token
  };
}

const github = githubConfig();
const bitbucket = bitbucketConfig();
if (!github.ready || !bitbucket.ready) process.stdout.write(`${NOT_RUN_MESSAGE}\n`);

function smokePageFunction() {
  return async ({ provider, token, settings, githubWriteAuthorized }) => {
    const allowedCodes = new Set([
      'authentication_failed', 'branch_not_found', 'conditional_write_unavailable', 'disposable_confirmation_required',
      'empty_fixture_playlist', 'file_not_found', 'network_or_cors_error', 'permission_denied', 'provider_unavailable',
      'provider_request_failed', 'publish_not_confirmed', 'rate_limited', 'readback_mismatch', 'remote_conflict',
      'remote_reconciliation_required', 'request_timeout', 'repository_not_private', 'repository_or_file_not_found',
      'stale_conflict_missing', 'unsafe_playlist_content', 'write_outcome_uncertain'
    ]);
    const [{ createGitPlaylistClient, serializeRemotePlaylist }, { createSanitizedProviderFetch, formatSanitizedProviderDiagnostic }] = await Promise.all([
      import('/git-playlist-storage.js'),
      import('/tests/integration/git-playlist-provider-diagnostics.js')
    ]);
    const diagnostics = [];
    const fetchImpl = createSanitizedProviderFetch({
      provider,
      token,
      fetchImpl: window.fetch.bind(window),
      onDiagnostic: event => diagnostics.push(event)
    });
    const client = createGitPlaylistClient({ fetchImpl });
    const signature = playlist => JSON.stringify({
      name: playlist.name,
      items: playlist.items.map(item => ({
        name: item.name,
        type: item.type,
        sourceUrl: item.sourceUrl,
        includeAudio: item.includeAudio,
        displayDuration: item.displayDuration
      }))
    });
    const safeCode = error => allowedCodes.has(error?.code) ? error.code : 'smoke_failed';
    const report = {
      provider,
      outcome: 'failed',
      errorCode: null,
      visibility: null,
      readVerified: false,
      publishConfirmed: false,
      readbackVerified: false,
      staleConflictVerified: false,
      cleanupVerified: provider !== 'github',
      cleanupCode: null,
      secretLeakDetected: false,
      diagnostics
    };
    let original = null;
    let writeAttempted = false;
    const smokeSignatures = new Set();

    try {
      const connection = await client.connect(settings, token);
      report.visibility = connection.visibility;
      if (connection.visibility !== 'private') throw Object.assign(new Error(), { code: 'repository_not_private' });

      original = await client.readPlaylist(settings);
      if (!original.playlist.items.length) throw Object.assign(new Error(), { code: 'empty_fixture_playlist' });
      report.readVerified = true;

      if (provider === 'github') {
        if (!githubWriteAuthorized) throw Object.assign(new Error(), { code: 'disposable_confirmation_required' });
        const runId = crypto.randomUUID();
        const createCandidate = suffix => serializeRemotePlaylist([{
          sourceUrl: `https://example.com/blend-provider-smoke-${runId}-${suffix}.mp3`,
          name: `Blend disposable provider smoke ${suffix}`,
          type: 'audio'
        }], `Blend disposable provider smoke ${suffix}`);
        const firstText = createCandidate('first');
        const staleText = createCandidate('stale');
        const winnerText = createCandidate('winner');
        for (const text of [firstText, staleText, winnerText]) smokeSignatures.add(signature(JSON.parse(text)));

        writeAttempted = true;
        const firstReview = await client.preparePublish(settings, firstText);
        const firstPublish = await client.publish(firstReview);
        report.publishConfirmed = !!firstPublish.commit || !!firstPublish.alreadyCurrent;
        if (!report.publishConfirmed) throw Object.assign(new Error(), { code: 'publish_not_confirmed' });

        const firstReadback = await client.readPlaylist(settings);
        report.readbackVerified = signature(firstReadback.playlist) === signature(JSON.parse(firstText));
        if (!report.readbackVerified) throw Object.assign(new Error(), { code: 'readback_mismatch' });

        const staleReview = await client.preparePublish(settings, staleText);
        const winningReview = await client.preparePublish(settings, winnerText);
        const winningPublish = await client.publish(winningReview);
        if (!winningPublish.commit && !winningPublish.alreadyCurrent) throw Object.assign(new Error(), { code: 'publish_not_confirmed' });
        try {
          await client.publish(staleReview);
        } catch (error) {
          report.staleConflictVerified = error?.code === 'remote_conflict';
          if (!report.staleConflictVerified) throw error;
        }
        if (!report.staleConflictVerified) throw Object.assign(new Error(), { code: 'stale_conflict_missing' });
        const winningReadback = await client.readPlaylist(settings);
        if (signature(winningReadback.playlist) !== signature(JSON.parse(winnerText))) {
          throw Object.assign(new Error(), { code: 'readback_mismatch' });
        }
      }

      report.outcome = 'success';
    } catch (error) {
      report.errorCode = safeCode(error);
    } finally {
      if (provider === 'github' && original && writeAttempted) {
        try {
          const current = await client.readPlaylist(settings);
          const currentSignature = signature(current.playlist);
          if (currentSignature === signature(original.playlist)) {
            report.cleanupVerified = true;
          } else if (smokeSignatures.has(currentSignature)) {
            const cleanupReview = await client.preparePublish(settings, original.text);
            try {
              await client.publish(cleanupReview);
            } catch (error) {
              if (error?.code !== 'write_outcome_uncertain') throw error;
            }
            let restored = await client.readPlaylist(settings);
            if (signature(restored.playlist) !== signature(original.playlist)
                && smokeSignatures.has(signature(restored.playlist))) {
              const reconciledCleanup = await client.preparePublish(settings, original.text);
              await client.publish(reconciledCleanup);
              restored = await client.readPlaylist(settings);
            }
            report.cleanupVerified = signature(restored.playlist) === signature(original.playlist);
            if (!report.cleanupVerified) report.cleanupCode = 'cleanup_verification_failed';
          } else {
            report.cleanupCode = 'cleanup_state_unrecognized';
          }
        } catch (error) {
          report.cleanupCode = safeCode(error);
        }
      }

      const storageSnapshot = {
        url: location.href,
        repositorySettings: localStorage.getItem('blend-git-playlist-repository-v1') || '',
        rememberedCredential: localStorage.getItem('blend-git-playlist-credential-v1') || '',
        publicCatalogSettings: localStorage.getItem('blend-public-git-catalog-v1') || ''
      };
      const secretCheckedValues = JSON.stringify({
        settings,
        diagnostics: diagnostics.map(formatSanitizedProviderDiagnostic),
        fixture: original?.text || '',
        storageSnapshot
      });
      report.secretLeakDetected = secretCheckedValues.includes(token);
    }

    if (provider === 'github' && writeAttempted && !report.cleanupVerified) {
      report.outcome = 'failed';
      report.errorCode = report.cleanupCode || report.errorCode || 'cleanup_verification_failed';
    }

    return report;
  };
}

async function runSmoke(page, config, githubWriteAuthorized) {
  const app = new BlendAppPage(page);
  await app.boot();
  return page.evaluate(smokePageFunction(), {
    ...config,
    githubWriteAuthorized
  });
}

function printDiagnostics(report) {
  for (const diagnostic of report.diagnostics || []) {
    process.stdout.write(`${formatSanitizedProviderDiagnostic(diagnostic)}\n`);
  }
}

test.describe('opt-in GitHub live smoke', () => {
  test.skip(!github.ready, NOT_RUN_MESSAGE);

  test('verifies a disposable private repository and restores its fixture', async ({ page }) => {
    test.setTimeout(300000);
    const report = await runSmoke(page, github, true);
    printDiagnostics(report);
    expect(report.provider).toBe('github');
    expect(report.visibility).toBe('private');
    expect(report.readVerified).toBe(true);
    expect(report.outcome).toBe('success');
    expect(report.errorCode).toBeNull();
    expect(report.publishConfirmed).toBe(true);
    expect(report.readbackVerified).toBe(true);
    expect(report.staleConflictVerified).toBe(true);
    expect(report.cleanupVerified).toBe(true);
    expect(report.cleanupCode).toBeNull();
    expect(report.secretLeakDetected).toBe(false);
  });
});

test.describe('opt-in Bitbucket live smoke', () => {
  test.skip(!bitbucket.ready, NOT_RUN_MESSAGE);

  test('verifies a disposable private repository read only', async ({ page, browser }) => {
    test.setTimeout(300000);
    const report = await runSmoke(page, bitbucket, false);
    printDiagnostics(report);
    process.stdout.write(`Bitbucket read-only smoke result: ${JSON.stringify({
      provider: report.provider,
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      outcome: report.outcome,
      visibility: report.visibility,
      readVerified: report.readVerified,
      errorCode: report.errorCode
    })}\n`);
    expect(report.provider).toBe('bitbucket');
    expect(report.visibility).toBe('private');
    expect(report.readVerified).toBe(true);
    expect(report.outcome).toBe('success');
    expect(report.errorCode).toBeNull();
    expect(report.cleanupVerified).toBe(true);
    expect(report.secretLeakDetected).toBe(false);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.diagnostics.every(event => event.method === 'GET')).toBe(true);
  });
});

