import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';
import { loadCoreConfig } from '../../core/src/config.js';

const env = { AEVRA_USERNAME: 'admin', AEVRA_PASSWORD: 'test-ports-only' };

function resolved(args: string[], extra: NodeJS.ProcessEnv = {}) {
  const command = parseAevraArgs(args) as any;
  return loadCoreConfig({ ...env, ...extra }, command.ports);
}

function listeners(config: ReturnType<typeof loadCoreConfig>) {
  return [config.publicPort, config.adminPort, config.mcpPort, (config as any).browserPort];
}

test('base startup shifts all four listeners with either value syntax and UI flag order', () => {
  for (const args of [
    ['start', '--ui', '--basePort=50000'],
    ['start', '--basePort', '50000', '--ui'],
  ]) {
    assert.equal((parseAevraArgs(args) as any).uiDestination, '/');
    assert.deepEqual(listeners(resolved(args)), [50000, 50001, 50002, 50003]);
  }
});

test('long and short individual options select identical listener addresses', () => {
  for (const args of [
    ['--gateway-port=51000', '--ui-port', '52000', '--mcp-port=53000', '--ws-port', '54000'],
    ['--gp', '51000', '--up=52000', '--mp', '53000', '--wp=54000'],
  ]) {
    assert.deepEqual(listeners(resolved(['start', '--ui', ...args])), [51000, 52000, 53000, 54000]);
  }
});

test('individual startup preserves other configured listeners and never mutates environment', () => {
  const configured = { AEVRA_PUBLIC_PORT: '50000', AEVRA_BROWSER_PORT: '50003' };
  assert.deepEqual(
    listeners(resolved(['start', '--up=51000'], configured)),
    [50000, 51000, 47832, 50003],
  );
  assert.deepEqual(configured, { AEVRA_PUBLIC_PORT: '50000', AEVRA_BROWSER_PORT: '50003' });
  assert.deepEqual(listeners(resolved(['start'])), [47830, 47831, 47832, 47833]);
});

test('explicit CLI ports take precedence over per-listener environment settings', () => {
  assert.deepEqual(
    listeners(
      resolved(['start', '--basePort=50000'], {
        AEVRA_PUBLIC_PORT: '51000',
        AEVRA_ADMIN_PORT: '51001',
        AEVRA_MCP_PORT: '51002',
        AEVRA_BROWSER_PORT: '51003',
      }),
    ),
    [50000, 50001, 50002, 50003],
  );
});

test('invalid port values and ambiguous mode or alias combinations fail before startup', () => {
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'abc', '65536', '1e4', '0x1234', ' 50000']) {
    assert.throws(() => parseAevraArgs(['start', `--gp=${value}`]), /port|integer|value/i, value);
  }
  for (const args of [
    ['--basePort=65533'],
    ['--gp'],
    ['--gp', '--ui'],
    ['--basePort=50000', '--mp=51000'],
    ['--basePort=50000', '--basePort=51000'],
    ['--gateway-port=50000', '--gp=51000'],
    ['--up=50001', '--up=50002'],
  ])
    assert.throws(() => parseAevraArgs(['start', ...args]), /port|value|duplicate|mix/i);
  assert.deepEqual(
    listeners(resolved(['start', '--basePort=65532'])),
    [65532, 65533, 65534, 65535],
  );
  assert.equal(resolved(['start', '--gp=1']).publicPort, 1);
  assert.equal(resolved(['start', '--gp=65535']).publicPort, 65535);
});

test('configured collisions between selected and unchanged listeners fail before binding', () => {
  assert.throws(() => resolved(['start', '--gp=47831']), /distinct|collision|same/i);
  assert.throws(() => resolved(['start', '--mp=50000', '--wp=50000']), /distinct|collision|same/i);
});

test('service installation, start and restart accept both modes but stop and status reject them', () => {
  for (const action of ['install', 'start', 'restart']) {
    const parsed = parseAevraArgs(['service', action, '--basePort=50000']) as any;
    assert.equal(parsed.ports.basePort, 50000);
    assert.deepEqual(
      listeners(resolved(['service', action, '--up=51000'])),
      [47830, 51000, 47832, 47833],
    );
  }
  for (const action of ['stop', 'status']) {
    assert.throws(() => parseAevraArgs(['service', action, '--basePort=50000']));
  }
});
