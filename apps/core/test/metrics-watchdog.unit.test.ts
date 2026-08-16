import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsService } from '../src/metrics.js';
import { TunnelWatchdog } from '../src/cloudflare/watchdog.js';
test('metrics snapshot aggregates calls and durations', () => {
  const m = new MetricsService();
  m.record('file_read', 10);
  m.record('file_read', 30);
  m.record('aevra_status', 5);
  const snap = m.snapshot();
  assert.deepEqual(
    snap.find((x) => x.tool === 'file_read'),
    { tool: 'file_read', calls: 2, totalMs: 40, avgMs: 20 },
  );
  assert.equal(snap.length, 2);
  m.reset();
  assert.deepEqual(m.snapshot(), []);
});
test('tunnel watchdog records status and signals drops', async () => {
  let reachable = true;
  const drops: string[] = [];
  const wd = new TunnelWatchdog(
    async () => ({ reachable, message: reachable ? 'reachable' : 'HTTP 403' }),
    10,
    (msg) => drops.push(msg),
  );
  wd.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(wd.status.reachable, true);
  reachable = false;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(wd.status.reachable, false);
  assert.equal(wd.status.checkedAt !== null, true);
  assert.equal(drops.length >= 1, true);
  wd.stop();
});
