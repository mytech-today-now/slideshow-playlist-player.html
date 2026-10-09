import { test, expect } from '@playwright/test';

test('measures synthetic experience snapshot saves against IndexedDB at product and stress scales', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/index.html');

  const report = await page.evaluate(async () => {
    const persistence = await import('/experience-persistence.js');
    const fixtureTools = await import('/tests/benchmarks/experience-persistence-fixture.js');
    const {
      EXPERIENCE_BENCHMARK_ITEM_COUNTS,
      EXPERIENCE_BENCHMARK_SCENARIOS,
      createExperienceBenchmarkFixture,
      createExperienceBenchmarkScenario,
      experienceBenchmarkMergeEntryCount,
      experienceBenchmarkSnapshotSummary
    } = fixtureTools;
    const {
      EXPERIENCE_SNAPSHOT_REVISION_KEY,
      EXPERIENCE_SNAPSHOT_STORE_NAMES,
      persistExperienceSnapshotAtomically,
      readExperienceSnapshotAtomically
    } = persistence;
    const measuredLongTasks = [];
    const hasLongTaskObserver = typeof PerformanceObserver === 'function' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask');
    const observer = hasLongTaskObserver ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) measuredLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }) : null;
    observer?.observe({ type: 'longtask', buffered: false });
    let activeCounters = null;
    const originalGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (activeCounters) activeCounters.getAllReads += 1;
      return originalGetAll.apply(this, args);
    };

    const openDatabase = name => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
          if (db.objectStoreNames.contains(storeName)) continue;
          const keyPath = storeName === 'library' || storeName === 'dirHandles' || storeName === 'experiences'
            ? 'id'
            : 'key';
          db.createObjectStore(storeName, { keyPath });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Synthetic benchmark database could not open'));
    });
    const transactionDone = transaction => new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Synthetic benchmark transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Synthetic benchmark transaction aborted'));
    });
    const populate = async (db, recordsByStore) => {
      const transaction = db.transaction(EXPERIENCE_SNAPSHOT_STORE_NAMES, 'readwrite');
      for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
        const store = transaction.objectStore(storeName);
        for (const record of recordsByStore[storeName]) store.put(record);
      }
      await transactionDone(transaction);
    };
    const resetScenario = async (db, fixture, scenario) => {
      const storeNames = scenario === 'setting'
        ? ['settings', 'experiences']
        : scenario === 'list-entry'
          ? ['playlist', 'experiences', 'settings']
          : ['library', 'settings'];
      const transaction = db.transaction(storeNames, 'readwrite');
      if (scenario === 'setting') {
        transaction.objectStore('settings').put(fixture.settings[0]);
        transaction.objectStore('experiences').put(fixture.experiences[0]);
      } else if (scenario === 'list-entry') {
        transaction.objectStore('playlist').put(fixture.playlist[0]);
        transaction.objectStore('experiences').put(fixture.experiences[0]);
      } else {
        transaction.objectStore('library').put(fixture.library[0]);
      }
      transaction.objectStore('settings').delete(EXPERIENCE_SNAPSHOT_REVISION_KEY);
      await transactionDone(transaction);
    };
    const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const percentile = (values, fraction) => {
      const ordered = values.slice().sort((left, right) => left - right);
      return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
    };
    const summarize = samples => {
      const stores = EXPERIENCE_SNAPSHOT_STORE_NAMES;
      const writesByStore = Object.fromEntries(stores.map(storeName => [
        storeName,
        samples[0].writesByStore[storeName] || { put: 0, delete: 0 }
      ]));
      const heapDeltas = samples.map(sample => sample.heapDeltaBytes).filter(Number.isFinite);
      const allLongTasks = samples.flatMap(sample => sample.longTasks);
      return {
        sampleCount: samples.length,
        getAllReadsPerSave: samples.map(sample => sample.getAllReads),
        mergeEntriesVisitedPerSave: samples.map(sample => sample.mergeEntriesVisited),
        queuedWritesPerSave: samples.map(sample => sample.queuedWrites),
        queuedWritesByStorePerSave: writesByStore,
        p50DurationMs: Number(percentile(samples.map(sample => sample.durationMs), 0.5).toFixed(3)),
        p95DurationMs: Number(percentile(samples.map(sample => sample.durationMs), 0.95).toFixed(3)),
        heapUsedBeforeBytes: samples[0].heapBeforeBytes,
        heapUsedAfterBytes: samples.at(-1).heapAfterBytes,
        heapDeltaBytesMedian: heapDeltas.length ? Math.round(percentile(heapDeltas, 0.5)) : null,
        memoryMeasurementAvailable: heapDeltas.length > 0,
        longTaskCount: allLongTasks.length,
        longTaskDurationMs: Number(allLongTasks.reduce((total, task) => total + task.duration, 0).toFixed(3)),
        longTaskObserverAvailable: hasLongTaskObserver
      };
    };

    const results = [];
    try {
      for (const itemCount of EXPERIENCE_BENCHMARK_ITEM_COUNTS) {
        const fixture = createExperienceBenchmarkFixture(itemCount);
        const fixtureSummary = experienceBenchmarkSnapshotSummary(fixture);
        const databaseName = `blend-issue08-benchmark-${itemCount}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const db = await openDatabase(databaseName);
        await populate(db, fixture);
        const scenarios = [];

        for (const scenario of EXPERIENCE_BENCHMARK_SCENARIOS) {
          const samples = [];
          for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
            const recordsByStore = createExperienceBenchmarkScenario(fixture, scenario, sampleIndex);
            const counters = { getAllReads: 0, queuedWrites: 0, writesByStore: {} };
            const heapBeforeBytes = performance.memory?.usedJSHeapSize ?? null;
            const startedAt = performance.now();
            activeCounters = counters;
            const result = await persistExperienceSnapshotAtomically({
              db,
              recordsByStore,
              baseRecordsByStore: fixture,
              expectedRevision: 0,
              keepLibraryKeys: fixture.library.map(record => record.id),
              afterWriteQueued: ({ storeName, operation }) => {
                counters.queuedWrites += 1;
                const storeCounters = counters.writesByStore[storeName] || (counters.writesByStore[storeName] = { put: 0, delete: 0 });
                storeCounters[operation] += 1;
              }
            });
            const finishedAt = performance.now();
            activeCounters = null;
            await delay(0);
            const heapAfterBytes = performance.memory?.usedJSHeapSize ?? null;
            const persisted = await readExperienceSnapshotAtomically({ db });
            const expectedJson = JSON.stringify(result.recordsByStore);
            const persistedJson = JSON.stringify(persisted.recordsByStore);
            if (expectedJson !== persistedJson) throw new Error('Synthetic benchmark snapshot serialization did not match after save');
            if (result.revision !== 1 || persisted.revision !== 1) throw new Error('Synthetic benchmark revision did not advance exactly once');
            for (const storeName of EXPERIENCE_SNAPSHOT_STORE_NAMES) {
              if (persisted.recordsByStore[storeName].length !== fixture[storeName].length) {
                throw new Error('Synthetic benchmark record count changed unexpectedly');
              }
            }
            const sampleLongTasks = measuredLongTasks.filter(entry => entry.startTime >= startedAt && entry.startTime < finishedAt);
            samples.push({
              durationMs: finishedAt - startedAt,
              getAllReads: counters.getAllReads,
              mergeEntriesVisited: experienceBenchmarkMergeEntryCount(fixture, recordsByStore, fixture),
              queuedWrites: counters.queuedWrites,
              writesByStore: counters.writesByStore,
              heapBeforeBytes,
              heapAfterBytes,
              heapDeltaBytes: heapBeforeBytes == null || heapAfterBytes == null ? null : heapAfterBytes - heapBeforeBytes,
              longTasks: sampleLongTasks
            });
            await resetScenario(db, fixture, scenario);
          }
          scenarios.push({ scenario, ...summarize(samples) });
        }

        db.close();
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error('Synthetic benchmark database could not be deleted'));
        });
        results.push({
          libraryItemCount: itemCount,
          fixture: fixtureSummary,
          mergeEntriesPerSave: experienceBenchmarkMergeEntryCount(fixture, fixture, fixture),
          scenarios
        });
      }
    } finally {
      activeCounters = null;
      IDBObjectStore.prototype.getAll = originalGetAll;
      observer?.disconnect();
    }

    return {
      benchmark: 'experience-persistence-native-indexeddb',
      browser: 'Playwright default browser',
      syntheticOnly: true,
      results
    };
  });

  console.log(`[ISSUE08 BENCHMARK] ${JSON.stringify(report)}`);
  expect(report.results.map(result => result.libraryItemCount)).toEqual([1000, 10000, 20000]);
  for (const result of report.results) {
    expect(result.fixture.recordCount).toBeGreaterThan(result.libraryItemCount);
    for (const scenario of result.scenarios) {
      expect(scenario.getAllReadsPerSave).toEqual([6, 6, 6]);
      expect(scenario.queuedWritesPerSave.every(count => count > 0)).toBe(true);
      expect(scenario.sampleCount).toBe(3);
    }
  }
});
