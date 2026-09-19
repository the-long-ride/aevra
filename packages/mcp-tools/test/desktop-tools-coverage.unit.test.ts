import assert from 'node:assert/strict';
import test from 'node:test';
import { handleDesktopTool } from '../src/desktop-tools.js';
import { toolDefinitions } from '../src/registry.js';
import { desktopContext } from './desktop-context.js';

test('desktop_click by coordinate is audited with the coordinate as target', async () => {
  const ctx = desktopContext({ yolo: true });
  await handleDesktopTool(ctx.value, 's1', 'desktop_click', { x: 10, y: 20 });
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_click');
  assert.equal(entry.target, '10,20');
});

test('desktop_scroll with deltaY succeeds and is audited as the focused element', async () => {
  // desktop_scroll takes no ref/x/y - see registry-desktop-schemas.ts for
  // why: helper/src/act.rs's scroll arm reads only deltaY, so an
  // advertised ref would silently be dropped rather than doing anything.
  const ctx = desktopContext({ yolo: true });
  await handleDesktopTool(ctx.value, 's1', 'desktop_scroll', { deltaY: 100 });
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_scroll');
  assert.equal(entry.target, 'focused-element');
});

test('desktop_key with no target audits as focused-element', async () => {
  const ctx = desktopContext({ yolo: true });
  await handleDesktopTool(ctx.value, 's1', 'desktop_key', { keys: 'Enter' });
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_key');
  assert.equal(entry.target, 'focused-element');
});

test('a refused input action is audited as FAILED and the error propagates', async () => {
  const ctx = desktopContext({ yolo: true });
  await assert.rejects(
    () => handleDesktopTool(ctx.value, 's1', 'desktop_click', { ref: 'fail-ref' }),
    (error: any) => error.code === 'DESKTOP_INPUT_REFUSED',
  );
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_click');
  assert.equal(entry.result, 'FAILED');
});

test('desktop_capture with no window still evaluates the gate and audits an allow verdict', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_capture', {
    windowId: 'no-window',
  });
  assert.equal(result.window, null);
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_capture');
  // Capture is always allowed regardless of attribution - the point of this
  // test is that the gate is still *evaluated* (and audited) for the
  // unattributable case, not skipped, since an unattributable window is the
  // one interesting read verdict.
  assert.equal(entry.gateVerdict, 'allow');
  assert.ok(entry.gateRule.length > 0);
});

test('desktop_describe redacts nested node value and children', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_describe', {
    windowId: 'w1',
    maxNodes: 10,
    interactiveOnly: true,
  });
  assert.equal(result.nodes[0].value, '[REDACTED]');
  assert.equal(result.nodes[0].children[0].name, 'Child');
});

test('desktop_disconnect runs and is audited', async () => {
  const ctx = desktopContext();
  await handleDesktopTool(ctx.value, 's1', 'desktop_disconnect', {});
  assert.ok(ctx.auditEntries.some((e: any) => e.tool === 'desktop_disconnect'));
});

test('a malformed stored desktop policy falls back to the default instead of crashing', async () => {
  // Missing `applications` would make the gate's `matches()` throw a bare
  // TypeError; a policy shaped like only `{ unattributedInput: 'allow' }`
  // would otherwise silently replace the whole default policy including the
  // denylist. Either way this must fail closed onto `defaultDesktopPolicy()`
  // rather than propagate a crash or a silently-widened policy.
  const ctx = desktopContext({ yolo: true, settingsPolicy: { unattributedInput: 'allow' } });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_click', { ref: 'ref_1_1' });
  assert.equal(result.gateVerdict, 'allow');
});

test('desktop_windows collapses executablePath to its basename by default', async () => {
  const ctx = desktopContext();
  // The fixture window's processName is 'notepad.exe' with no executablePath
  // set by default, so override it here to actually exercise collapsing.
  ctx.window.executablePath = 'C:\\Windows\\System32\\notepad.exe';
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_windows', {});
  assert.equal(result.result[0].executablePath, 'notepad.exe');
});

test('desktop_windows reports the full executablePath when the policy opts in', async () => {
  const ctx = desktopContext({
    settingsPolicy: {
      mode: 'denylist',
      applications: [],
      unattributedInput: 'deny',
      exposeExecutablePaths: true,
    },
  });
  ctx.window.executablePath = 'C:\\Windows\\System32\\notepad.exe';
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_windows', {});
  assert.equal(result.result[0].executablePath, 'C:\\Windows\\System32\\notepad.exe');
});

test('toolDefinitions exposes all background desktop tools with correct schema and annotations', () => {
  const defs = toolDefinitions();
  const byName = new Map(defs.map((d) => [d.name, d]));

  const backgroundTools = [
    'desktop_invoke',
    'desktop_set_value',
    'desktop_select',
    'desktop_toggle',
    'desktop_release_window',
  ] as const;

  for (const name of backgroundTools) {
    const def = byName.get(name);
    assert.ok(def, `Expected toolDefinition for ${name}`);
    assert.ok(def.description);
    assert.equal(def.inputSchema.type, 'object');
    if (name !== 'desktop_release_window') {
      assert.equal(def.annotations.destructiveHint, true);
      assert.equal(def.annotations.openWorldHint, true);
    }
  }
});

test('desktop_invoke, desktop_select, desktop_toggle succeed and audit properly', async () => {
  for (const tool of ['desktop_invoke', 'desktop_select', 'desktop_toggle'] as const) {
    const ctx = desktopContext({ yolo: true });
    const result: any = await handleDesktopTool(ctx.value, 's1', tool, {
      windowId: 'w1',
      windowLeaseId: 'lease-1',
      snapshotId: 'snap-1',
      ref: 'ref_1_1',
    });
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'completed');
    const entry = ctx.auditEntries.find((e: any) => e.tool === tool);
    assert.ok(entry, `expected audit entry for ${tool}`);
    assert.equal(entry.target, 'w1:ref_1_1');
    assert.equal(entry.result, 'SUCCEEDED');
  }
});

test('desktop_release_window succeeds and audits properly', async () => {
  const ctx = desktopContext({ yolo: true });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_release_window', {
    windowId: 'w1',
    windowLeaseId: 'lease-1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.released, true);
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_release_window');
  assert.ok(entry);
  assert.equal(entry.target, 'window:w1');
  assert.equal(entry.result, 'SUCCEEDED');
});
