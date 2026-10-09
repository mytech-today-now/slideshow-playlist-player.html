import { performance } from 'node:perf_hooks';
import {
  EXPERIENCE_SNAPSHOT_REVISION_KEY,
  EXPERIENCE_SNAPSHOT_STORE_NAMES,
  persistExperienceSnapshotAtomically
} from '../../experience-persistence.js';
import {
  EXPERIENCE_BENCHMARK_ITEM_COUNTS,
  EXPERIENCE_BENCHMARK_SCENARIOS,
  createExperienceBenchmarkFixture,
  createExperienceBenchmarkScenario,
  experienceBenchmarkMergeEntryCount,
  experienceBenchmarkSnapshotSummary
} from './experience-persistence-fixture.js';

const SAMPLE_COUNT = 3;

function recordKey(record) {
  return record?.id ?? record?.key;
}

class SyntheticIndexedDB {
  constructor(recordsByStore) {
    this.recordsByStore = Object.fromEntries(EXPERIENCE_SNAPSHOT_STORE_NAMES.map(storeName => [
      storeName,
      new Map((recordsByStore[storeName] || []).map(record => [recordKey(record), structuredClone(record)]))
    ]));
    this.getAllReads = 0;
    this.operations = [];
  }

  transaction(storeNames) {
    const transaction = {
      oncomplete: null,
      onabort: null,
      onerror: null,
      error: null,
      operations: [],
      pendingReads: storeNames.length,
      aborted: false,
      objectStore: storeName => ({
        getAll: () => {
          const request = { result: null, onsuccess: null, onerror: null };
          this.getAllReads += 1;
          queueMicrotask(() => {
            if (transaction.aborted) return;
            request.result = Array.from(this.recordsByStore[storeName].values(), record => structuredClone(record));
            request.onsuccess?.({ target: request });
            transaction.pendingReads -= 1;
            if (transaction.pendingReads === 0) {
              setTimeout(() => {
                if (transaction.aborted) return;
                for (const operation of transaction.operations) {
                  const records = this.recordsByStore[operation.storeName];
                  if (operation.operation === 'delete') records.delete(operation.key);
                  else records.set(recordKey(operation.record), structuredClone(operation.record));
                }
                this.operations = transaction.operations;
                transaction.oncomplete?.({ target: transaction });
              }, 0);
            }
          });
          return request;
        },
        put: record => transaction.operations.push({ storeName, operation: 'put', record }),
        delete: key => transaction.operations.push({ storeName, operation: 'delete', key })
      }),
      abort: () => {
        transaction.aborted = true;
        queueMicrotask(() => transaction.onabort?.({ target: transaction }));
      }
    };
    return transaction;
  }
}

function percentile(values, fraction) {
  const ordered = values.slice().sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

function summarizeSamples(samples) {
  const writeCountsByStore = Object.fromEntries(EXPERIENCE_SNAPSHOT_STORE_NAMES.map(storeName => [
    storeName,
    samples.map(sample => sample.writeCountsByStore[storeName] || 0)
  ]));
  return {
    sampleCount: samples.length,
    getAllReadsPerSave: samples.map(sample => sample.getAllReads),
    mergeEntriesVisitedPerSave: samples.map(sample => sample.mergeEntriesVisited),
    queuedWritesPerSave: samples.map(sample => sample.queuedWrites),
    queuedWritesByStorePerSave: Object.fromEntries(Object.entries(writeCountsByStore).map(([storeName, values]) => [
      storeName,
      values[0]
    ])),
    p50DurationMs: Number(percentile(samples.map(sample => sample.durationMs), 0.5).toFixed(3)),
    p95DurationMs: Number(percentile(samples.map(sample => sample.durationMs), 0.95).toFixed(3)),
    heapBeforeBytes: Math.min(...samples.map(sample => sample.heapBeforeBytes)),
    heapAfterBytes: Math.max(...samples.map(sample => sample.heapAfterBytes)),
    heapDeltaBytesMedian: Math.round(percentile(samples.map(sample => sample.heapDeltaBytes), 0.5))
  };
}

async function measureScenario(fixture, scenario) {
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    const database = new SyntheticIndexedDB(fixture);
    const recordsByStore = createExperienceBenchmarkScenario(fixture, scenario, sampleIndex);
    let queuedWrites = 0;
    const writesByStore = {};
    const heapBeforeBytes = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const result = await persistExperienceSnapshotAtomically({
      db: database,
      recordsByStore,
      baseRecordsByStore: fixture,
      expectedRevision: 0,
      keepLibraryKeys: fixture.library.map(record => record.id),
      transactionFactory: (connection, storeNames) => connection.transaction(storeNames, 'readwrite'),
      afterWriteQueued: ({ storeName }) => {
        queuedWrites += 1;
        writesByStore[storeName] = (writesByStore[storeName] || 0) + 1;
      }
    });
    const durationMs = performance.now() - startedAt;
    const heapAfterBytes = process.memoryUsage().heapUsed;
    const databaseRecordsByStore = Object.fromEntries(EXPERIENCE_SNAPSHOT_STORE_NAMES.map(storeName => [
      storeName,
      Array.from(database.recordsByStore[storeName].values())
    ]));
    const revision = databaseRecordsByStore.settings.find(record => record?.key === EXPERIENCE_SNAPSHOT_REVISION_KEY);

    if (result.revision !== 1 || revision?.revision !== 1) throw new Error('Synthetic benchmark revision did not advance once');
    if (database.getAllReads !== EXPERIENCE_SNAPSHOT_STORE_NAMES.length) throw new Error('Synthetic benchmark did not read every snapshot store once');
    if (database.operations.length !== queuedWrites) throw new Error('Synthetic benchmark write instrumentation was inconsistent');

    samples.push({
      durationMs,
      getAllReads: database.getAllReads,
      mergeEntriesVisited: experienceBenchmarkMergeEntryCount(fixture, recordsByStore, fixture),
      queuedWrites,
      writeCountsByStore: writesByStore,
      heapBeforeBytes,
      heapAfterBytes,
      heapDeltaBytes: heapAfterBytes - heapBeforeBytes
    });
  }
  return summarizeSamples(samples);
}

const results = [];
for (const itemCount of EXPERIENCE_BENCHMARK_ITEM_COUNTS) {
  const fixture = createExperienceBenchmarkFixture(itemCount);
  const fixtureSummary = experienceBenchmarkSnapshotSummary(fixture);
  const scenarios = [];
  for (const scenario of EXPERIENCE_BENCHMARK_SCENARIOS) {
    scenarios.push({
      scenario,
      ...await measureScenario(fixture, scenario)
    });
  }
  results.push({
    libraryItemCount: itemCount,
    fixture: fixtureSummary,
    mergeEntriesPerSave: experienceBenchmarkMergeEntryCount(fixture, fixture, fixture),
    scenarios
  });
}

console.log(JSON.stringify({
  benchmark: 'experience-persistence-synthetic-node',
  environment: { runtime: process.version, platform: process.platform, arch: process.arch },
  syntheticOnly: true,
  results
}, null, 2));
