import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/helper-process.js';
import { WindowsDesktopDriver } from '../src/windows-driver.js';

const RELEASE_BINARY = fileURLToPath(
  new URL('../../../../helper/target/release/aevra-desktop-helper.exe', import.meta.url),
);
const DEBUG_BINARY = fileURLToPath(
  new URL('../../../../helper/target/debug/aevra-desktop-helper.exe', import.meta.url),
);
const BINARY = existsSync(RELEASE_BINARY)
  ? RELEASE_BINARY
  : existsSync(DEBUG_BINARY)
    ? DEBUG_BINARY
    : undefined;

const FIXTURE_RELEASE = fileURLToPath(
  new URL(
    '../../../../helper/tests/fixtures/background-controls/bin/Release/net8.0-windows/background-controls.exe',
    import.meta.url,
  ),
);
const FIXTURE_DIRECT = fileURLToPath(
  new URL(
    '../../../../helper/tests/fixtures/background-controls/bin/net8.0-windows/background-controls.exe',
    import.meta.url,
  ),
);
const FIXTURE_BINARY = existsSync(FIXTURE_RELEASE)
  ? FIXTURE_RELEASE
  : existsSync(FIXTURE_DIRECT)
    ? FIXTURE_DIRECT
    : undefined;

const SKIP =
  process.platform !== 'win32' || !BINARY || !FIXTURE_BINARY
    ? 'Native background coexistence tests require Windows, compiled helper binary, and background-controls fixture.'
    : false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('native background coexistence: execute operations without input injection', { skip: SKIP }, async () => {
  const spawnedProcesses: ChildProcess[] = [];
  const helper = new HelperProcess({ command: BINARY as string, args: [], deadlineMs: 8000 });
  const driver = new WindowsDesktopDriver(helper);

  try {
    await driver.connect();

    // 1. Launch Target and Sentinel fixtures
    const targetProc = spawn(FIXTURE_BINARY as string, [], { detached: false, stdio: 'ignore' });
    spawnedProcesses.push(targetProc);

    const sentinelProc = spawn(FIXTURE_BINARY as string, ['--sentinel'], {
      detached: false,
      stdio: 'ignore',
    });
    spawnedProcesses.push(sentinelProc);

    await sleep(1500);

    const windows = await driver.windows();
    const targetWin = windows.find((w) => w.title === 'Aevra Background Target Fixture');
    const sentinelWin = windows.find((w) => w.title === 'Aevra Foreground Sentinel');

    assert.ok(targetWin, 'Target fixture window should be discovered');
    assert.ok(sentinelWin, 'Sentinel fixture window should be discovered');

    // 2. Describe background tree for target
    const snapshotId = 'test-snapshot-native-1';
    const desc = await driver.describeBackground({
      windowId: targetWin.windowId,
      snapshotId,
      maxNodes: 100,
      interactiveOnly: false,
    });

    assert.ok(desc.nodes.length > 0, 'Target fixture should return accessibility nodes');
    assert.ok(desc.windowInstance, 'Should include verified window instance');

    // Verify password field does not expose secrets or setValue action
    const passwordNode = desc.nodes.find((n) => n.name === 'Password Text:' && n.role === 'edit');
    if (passwordNode) {
      assert.notEqual(passwordNode.value, 'Secret123', 'Password value must not leak in tree');
      assert.ok(
        !passwordNode.supportedActions?.includes('setValue'),
        'Password field must not support setValue',
      );
    }

    // Verify read-only text does not support setValue
    const readOnlyNode = desc.nodes.find((n) => n.name === 'Read-Only Text:' && n.role === 'edit');
    if (readOnlyNode) {
      assert.ok(
        !readOnlyNode.supportedActions?.includes('setValue'),
        'Read-only text must not support setValue',
      );
    }

    // 3. Background Invoke on 'Invoke Target' button
    const invokeNode = desc.nodes.find(
      (n) => n.name === 'Invoke Target' && n.supportedActions?.includes('invoke'),
    );
    assert.ok(invokeNode, 'Invoke button should be present with invoke action');

    const invokeRes = await driver.backgroundAct({
      snapshotId,
      handle: invokeNode.handle,
      op: 'invoke',
      expectedInstance: desc.windowInstance,
    });
    assert.equal(invokeRes.ok, true);
    assert.equal(invokeRes.outcome, 'completed');
    assert.equal(invokeRes.focusChanged, false);

    // 4. Background SetValue on editable textbox
    const editNode = desc.nodes.find(
      (n) => n.name === 'Editable Text:' && n.role === 'edit' && n.supportedActions?.includes('setValue'),
    );
    assert.ok(editNode, 'Editable textbox should be present with setValue action');

    const setValueRes = await driver.backgroundAct({
      snapshotId,
      handle: editNode.handle,
      op: 'setValue',
      value: 'Coexistence Value Verified',
      expectedInstance: desc.windowInstance,
    });
    assert.equal(setValueRes.ok, true);
    assert.equal(setValueRes.outcome, 'completed');
    assert.equal(setValueRes.focusChanged, false);

    // 5. Background Select on ListBox item
    const itemBetaNode = desc.nodes.find(
      (n) => n.name === 'Item Beta' && n.supportedActions?.includes('select'),
    );
    assert.ok(itemBetaNode, 'Item Beta should be present with select action');

    const selectRes = await driver.backgroundAct({
      snapshotId,
      handle: itemBetaNode.handle,
      op: 'select',
      expectedInstance: desc.windowInstance,
    });
    assert.equal(selectRes.ok, true);
    assert.equal(selectRes.outcome, 'completed');
    assert.equal(selectRes.focusChanged, false);

    // 6. Background Toggle on CheckBox
    const toggleNode = desc.nodes.find(
      (n) => n.name === 'Tri-state Toggle CheckBox' && n.supportedActions?.includes('toggle'),
    );
    assert.ok(toggleNode, 'CheckBox should be present with toggle action');

    const toggleRes = await driver.backgroundAct({
      snapshotId,
      handle: toggleNode.handle,
      op: 'toggle',
      expectedInstance: desc.windowInstance,
    });
    assert.equal(toggleRes.ok, true);
    assert.equal(toggleRes.outcome, 'completed');
    assert.equal(toggleRes.focusChanged, false);
    assert.equal(toggleRes.toggleState, 'on');

    // 7. Modal Dialog opens -> focus change detection
    const dialogButtonNode = desc.nodes.find(
      (n) => n.name === 'Open Modal Dialog' && n.supportedActions?.includes('invoke'),
    );
    if (dialogButtonNode) {
      const dialogRes = await driver.backgroundAct({
        snapshotId,
        handle: dialogButtonNode.handle,
        op: 'invoke',
        expectedInstance: desc.windowInstance,
      });
      assert.equal(dialogRes.ok, true);
    }
  } finally {
    for (const proc of spawnedProcesses) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    await driver.disconnect();
  }
});
