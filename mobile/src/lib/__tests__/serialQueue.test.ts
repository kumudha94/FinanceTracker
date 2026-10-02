import assert from 'node:assert/strict';
import { createSerialQueue } from '../serialQueue';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== Serial Queue Tests ===\n');

  await test('jobs run one at a time, in arrival order', async () => {
    const run = createSerialQueue();
    const log: string[] = [];
    const job = (name: string, ms: number) => run(async () => { log.push(`${name} start`); await sleep(ms); log.push(`${name} end`); });
    await Promise.all([job('A', 30), job('B', 1)]);
    assert.deepEqual(log, ['A start', 'A end', 'B start', 'B end']);
  });

  await test('a failing job rejects its caller but does not block the next', async () => {
    const run = createSerialQueue();
    const first = run(async () => { throw new Error('boom'); });
    const second = run(async () => 'ok');
    await assert.rejects(first, /boom/);
    assert.equal(await second, 'ok');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
