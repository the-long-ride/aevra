import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceScheduler } from '../src/resource-scheduler.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('same resource is serialized while independent resources can overlap', async () => {
  const scheduler = new ResourceScheduler();
  const events: string[] = [];

  const first = scheduler.run(['surface:a'], async () => {
    events.push('a1-start');
    await sleep(25);
    events.push('a1-end');
  });
  const second = scheduler.run(['surface:a'], async () => {
    events.push('a2-start');
    events.push('a2-end');
  });
  const independent = scheduler.run(['surface:b'], async () => {
    events.push('b-start');
    await sleep(5);
    events.push('b-end');
  });

  await Promise.all([first, second, independent]);
  assert.ok(events.indexOf('a1-end') < events.indexOf('a2-start'));
  assert.ok(events.indexOf('b-start') < events.indexOf('a1-end'));
});
