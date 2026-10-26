(() => {
  'use strict';

  const root = document.documentElement;
  const reportPreferencesKey = 'prompt-refined:report-preferences:v1';
  const progressKey = `prompt-refined:issue-progress:v1:${encodeURIComponent(window.location.pathname)}`;
  const validProgress = new Set(['incomplete', 'in-progress', 'complete']);
  const progressLabels = {
    incomplete: 'Not Complete',
    'in-progress': 'In Progress',
    complete: 'Completed'
  };
  const reportPreferences = document.querySelector('[data-report-preferences]');
  const styleControl = document.querySelector('[data-report-style-control]');
  const colorControl = document.querySelector('[data-color-mode-control]');
  const preferencesStatus = document.querySelector('[data-preferences-status]');
  const progressStatus = document.querySelector('[data-issue-progress-status]');
  let canPersist = true;

  function readStoredJson(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || 'null');
    } catch (_) {
      canPersist = false;
      return null;
    }
  }

  function saveStoredJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      canPersist = false;
      return false;
    }
  }

  function setAnnouncement(target, message) {
    if (target) target.textContent = message;
  }

  function applyPreferences(preferences) {
    const style = ['basic', 'minimal', 'full'].includes(preferences.reportStyle)
      ? preferences.reportStyle
      : ['basic', 'minimal', 'full'].includes(preferences.style) ? preferences.style : 'basic';
    const colorMode = ['system', 'light', 'dark'].includes(preferences.colorMode)
      ? preferences.colorMode
      : ['system', 'light', 'dark'].includes(preferences.mode) ? preferences.mode : 'system';
    root.dataset.reportStyle = style;
    root.dataset.colorMode = colorMode;
    if (styleControl) styleControl.value = style;
    if (colorControl) colorControl.value = colorMode;
  }

  function persistPreferences() {
    const value = {
      version: 1,
      reportStyle: styleControl?.value || 'basic',
      colorMode: colorControl?.value || 'system'
    };
    const saved = saveStoredJson(reportPreferencesKey, value);
    setAnnouncement(preferencesStatus, saved
      ? 'Appearance preferences saved for this browser.'
      : 'Appearance controls work for this page, but browser storage is unavailable so changes may not persist.');
  }

  function applyProgress(article, status) {
    const safeStatus = validProgress.has(status) ? status : 'incomplete';
    article.dataset.progress = safeStatus;
    article.classList.toggle('issue-progress-incomplete', safeStatus === 'incomplete');
    article.classList.toggle('issue-progress-in-progress', safeStatus === 'in-progress');
    article.classList.toggle('issue-progress-complete', safeStatus === 'complete');

    const issueId = article.id;
    const select = article.querySelector('[data-issue-progress-control]');
    const state = article.querySelector('[data-issue-progress-state]');
    if (select) select.value = safeStatus;
    if (state) {
      state.dataset.progress = safeStatus;
      state.textContent = progressLabels[safeStatus];
    }
    document.querySelectorAll('[data-issue-progress-indicator]').forEach(indicator => {
      if (indicator.dataset.issueProgressIndicator !== issueId) return;
      indicator.dataset.progress = safeStatus;
      indicator.textContent = progressLabels[safeStatus];
    });
  }

  function persistProgress(article, status) {
    const stored = readStoredJson(progressKey);
    const values = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    values[article.id] = validProgress.has(status) ? status : 'incomplete';
    const saved = saveStoredJson(progressKey, values);
    setAnnouncement(progressStatus, saved
      ? 'Issue progress saved for this document in this browser.'
      : 'Issue progress changes are active for this page, but browser storage is unavailable.');
  }

  function getIssueData(article) {
    const fields = {};
    article.querySelectorAll('[data-export-field]').forEach(section => {
      const key = section.dataset.exportField;
      const list = section.querySelector('ol, ul');
      if (list) fields[key] = [...list.querySelectorAll(':scope > li')].map(item => item.innerText.trim());
      else fields[key] = section.querySelector('pre')?.innerText.trim() || section.querySelector('p')?.innerText.trim() || '';
    });
    return {
      id: article.id,
      title: article.dataset.issueTitle || article.querySelector('.issue-title')?.innerText.trim() || '',
      kind: article.dataset.issueKind || '',
      progress: article.dataset.progress || 'incomplete',
      sourceFinding: 'ai-prompts/pre-mortem-2026-10-25-17-31-42.html#issue-01',
      fields
    };
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Use the selection fallback below when clipboard permission is denied.
      }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    area.remove();
    return copied;
  }

  function bindControls() {
    const savedPreferences = readStoredJson(reportPreferencesKey) || {};
    applyPreferences(savedPreferences);
    if (reportPreferences) reportPreferences.disabled = false;
    if (styleControl) styleControl.disabled = false;
    if (colorControl) colorControl.disabled = false;
    setAnnouncement(preferencesStatus, canPersist
      ? 'Appearance controls are ready. Changes persist in this browser.'
      : 'Appearance controls are ready for this page. Browser storage is unavailable.');

    styleControl?.addEventListener('change', persistPreferences);
    colorControl?.addEventListener('change', persistPreferences);

    const storedProgress = readStoredJson(progressKey) || {};
    document.querySelectorAll('.issue[data-progress]').forEach(article => {
      const current = storedProgress[article.id] || article.dataset.progress || 'incomplete';
      applyProgress(article, current);
      const select = article.querySelector('[data-issue-progress-control]');
      if (select) {
        select.disabled = false;
        select.addEventListener('change', () => {
          applyProgress(article, select.value);
          persistProgress(article, select.value);
        });
      }
    });
    setAnnouncement(progressStatus, canPersist
      ? 'Issue progress controls are ready. Changes persist for this document in this browser.'
      : 'Issue progress controls are ready for this page. Browser storage is unavailable.');

    document.querySelectorAll('[data-copy-prompt-button]').forEach(button => {
      button.addEventListener('click', async () => {
        const prompt = button.closest('.issue')?.querySelector('.implementation-prompt')?.innerText.trim() || '';
        const copied = await copyText(prompt);
        setAnnouncement(document.querySelector('[data-prompt-action-status]'), copied ? 'Implementation prompt copied.' : 'Copy failed. Select the prompt text and copy it manually.');
      });
    });

    document.querySelectorAll('[data-copy-issue-button]').forEach(button => {
      button.addEventListener('click', async () => {
        const article = button.closest('.issue');
        const copied = await copyText(article?.innerText.trim() || '');
        setAnnouncement(article?.querySelector('[data-issue-action-status]'), copied ? 'Issue text copied.' : 'Copy failed. Select the issue text and copy it manually.');
      });
    });

    document.querySelectorAll('[data-issue-json-button]').forEach(button => {
      button.addEventListener('click', async () => {
        const article = button.closest('.issue');
        const json = JSON.stringify(getIssueData(article), null, 2);
        const copied = await copyText(json);
        setAnnouncement(article?.querySelector('[data-issue-action-status]'), copied ? 'Issue JSON copied.' : 'Copy failed.');
      });
    });

    document.querySelectorAll('[data-document-json-button]').forEach(button => {
      button.addEventListener('click', async () => {
        const documentData = {
          title: document.title,
          generatedAt: '2026-10-25 20:11:08 America/Chicago',
          sourceTemplate: 'https://raw.githubusercontent.com/mytech-today-now/prompt-refined/refs/heads/main/ai-feeder-prompt.md',
          issues: [...document.querySelectorAll('.issue')].map(getIssueData)
        };
        const copied = await copyText(JSON.stringify(documentData, null, 2));
        setAnnouncement(document.querySelector('[data-document-json-status]'), copied ? 'Document JSON copied.' : 'Copy failed.');
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, { once: true });
  else bindControls();
})();
