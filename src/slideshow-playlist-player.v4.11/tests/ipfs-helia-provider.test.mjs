import test from 'node:test';
import assert from 'node:assert/strict';

import { awaitHeliaSideEffect as awaitBundledSideEffect } from '../ipfs-helia-provider.source.js';
import { awaitHeliaSideEffect as awaitDynamicSideEffect } from '../ipfs-helia-provider.js';

const providers = [
  ['bundled Helia provider source', awaitBundledSideEffect],
  ['dynamic Helia provider', awaitDynamicSideEffect]
];

for (const [name, awaitHeliaSideEffect] of providers) {
  test(`${name} accepts promise and iterable Helia side effects`, async () => {
    const steps = [];

    await awaitHeliaSideEffect(Promise.resolve().then(() => {
      steps.push('promise');
    }));

    await awaitHeliaSideEffect((async function* () {
      steps.push('async:start');
      yield 'pin';
      await Promise.resolve();
      steps.push('async:end');
    })());

    await awaitHeliaSideEffect((function* () {
      steps.push('sync:start');
      yield 'provide';
      steps.push('sync:end');
    })());

    await awaitHeliaSideEffect({ ok: true });

    assert.deepEqual(steps, [
      'promise',
      'async:start',
      'async:end',
      'sync:start',
      'sync:end'
    ]);
  });
}
