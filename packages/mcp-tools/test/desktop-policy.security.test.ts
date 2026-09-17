import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleDesktopTool } from '../src/desktop-tools.js';
import { desktopContext } from './desktop-context.js';

test('typed text never reaches the audit log', async () => {
  const ctx = desktopContext({ yolo: true });
  // Not a credential, and deliberately not shaped like one.
  const typed = 'a'.repeat(64);
  await handleDesktopTool(ctx.value, 's1', 'desktop_type', { text: typed });
  const entries = JSON.stringify(ctx.auditEntries);
  assert.equal(entries.includes(typed), false);
  assert.ok(entries.includes('desktop_type'));
  // The length is still recorded, just never the text.
  assert.ok(entries.includes(String(typed.length)));
});

test("a screenshot's imageDataUri never reaches the audit log", async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_capture', {});
  assert.equal(JSON.stringify(ctx.auditEntries).includes('data:image/'), false);
  // It IS returned to the caller.
  assert.match(result.imageDataUri, /^data:image\//);
});

test('desktop_describe output is marked untrusted', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_describe', {});
  assert.equal(result.untrusted, true);
});

test('an unknown tool name is refused with CAPABILITY_REQUIRED', async () => {
  const ctx = desktopContext({ yolo: true });
  await assert.rejects(
    () => handleDesktopTool(ctx.value, 's1', 'desktop_evaluate', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
});

test('a capture is audited, with a gate verdict recorded', async () => {
  const ctx = desktopContext();
  await handleDesktopTool(ctx.value, 's1', 'desktop_capture', {});
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_capture');
  assert.ok(entry, 'expected an audit entry for desktop_capture');
  assert.equal(entry.gateVerdict, 'allow');
  assert.ok(entry.gateRule.length > 0);
});

test('accessibility text is passed through the DLP pass before being returned', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_describe', {});
  // The fake worker returned the high-entropy attacker title as both the
  // window title and a node's accessible name; neither should survive intact.
  assert.notEqual(result.window.title, ctx.attackerTitle);
  assert.equal(result.window.title, '[REDACTED]');
  assert.notEqual(result.nodes[0].name, ctx.attackerTitle);
  assert.equal(result.nodes[0].name, '[REDACTED]');
});

test('desktop_windows output is marked untrusted and redacts titles', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_windows', {});
  assert.equal(result.untrusted, true);
  assert.equal(result.result[0].title, '[REDACTED]');
});

test('desktop_connect is MEDIUM risk; desktop_status is LOW', async () => {
  const ctx = desktopContext();
  await handleDesktopTool(ctx.value, 's1', 'desktop_connect', {});
  await handleDesktopTool(ctx.value, 's1', 'desktop_status', {});
  const connectEntry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_connect');
  const statusEntry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_status');
  assert.equal(connectEntry.risk, 'MEDIUM');
  assert.equal(statusEntry.risk, 'LOW');
});

test('a successful click audits the window identity and the gate verdict that allowed it', async () => {
  const ctx = desktopContext({ yolo: true });
  await handleDesktopTool(ctx.value, 's1', 'desktop_click', { ref: 'ref_1_1' });
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_click');
  assert.ok(entry, 'expected an audit entry for desktop_click');
  assert.equal(entry.window, 'notepad.exe');
  assert.equal(entry.gateVerdict, 'allow');
  assert.ok(entry.gateRule.length > 0);
});

test('a gate-refused click is audited with a deny verdict, distinguishing it from a driver crash', async () => {
  const ctx = desktopContext({ yolo: true });
  await assert.rejects(
    () => handleDesktopTool(ctx.value, 's1', 'desktop_click', { ref: 'fail-ref' }),
    (error: any) => error.code === 'DESKTOP_INPUT_REFUSED',
  );
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_click');
  assert.ok(entry, 'expected an audit entry for the refused desktop_click');
  assert.equal(entry.result, 'FAILED');
  assert.equal(entry.window, 'notepad.exe');
  assert.equal(entry.gateVerdict, 'deny');
  assert.ok(entry.gateRule.length > 0);
});

test('desktop_type never forwards the typed text to the authorization/approval layer', async () => {
  // The existing test context's lease already grants 'desktop.control', so
  // the approval branch of authorizeCapability never runs there and no test
  // using it would catch a regression on this path. Constructing a lease
  // WITHOUT the capability forces authorizeCapability down its
  // approvals.request(...) branch, which is the one that persists `original`
  // (and, before this fix, the raw typed text inside it).
  const ctx = desktopContext({ leaseCapabilities: [] });
  const typed = 'b'.repeat(64);
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_type', { text: typed });
  assert.equal(result.status, 'approval_pending');
  assert.equal(ctx.approvals.requests.length, 1);
  const forwarded = JSON.stringify(ctx.approvals.requests[0]);
  assert.equal(forwarded.includes(typed), false);
  assert.ok(forwarded.includes(String(typed.length)));
});

test('desktop_key never forwards the key sequence to the authorization/approval layer', async () => {
  // Same reasoning as the desktop_type test above: `keys` is exactly as
  // sensitive, since nothing stops a caller spelling out a password one
  // chord at a time instead of using desktop_type. Force the same
  // approvals.request(...) branch by withholding the capability from the
  // lease.
  const ctx = desktopContext({ leaseCapabilities: [] });
  const keys = 'b'.repeat(64);
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_key', { keys });
  assert.equal(result.status, 'approval_pending');
  assert.equal(ctx.approvals.requests.length, 1);
  const forwarded = JSON.stringify(ctx.approvals.requests[0]);
  assert.equal(forwarded.includes(keys), false);
  assert.ok(forwarded.includes(String(keys.length)));
});

test('input actions other than scroll cost an approval even with the capability leased', async () => {
  // The lease grants desktop.control, so before the risk tiers were raised
  // every one of these ran unattended for the life of the lease. The window
  // gate answers which window may receive an action, never whether it should
  // happen, so the approval is the only thing standing between a leased
  // session and an arbitrary click or keystroke.
  for (const [tool, args] of [
    ['desktop_click', { ref: 'ref_1_1' }],
    ['desktop_type', { text: 'hello there' }],
    ['desktop_key', { keys: 'Enter' }],
  ] as const) {
    const ctx = desktopContext();
    const result: any = await handleDesktopTool(ctx.value, 's1', tool, args);
    assert.equal(result.status, 'approval_pending', `${tool} ran without an approval`);
    assert.equal(ctx.worker.calls.length, 0, `${tool} reached the driver before approval`);
  }
});

test('scroll stays unattended so approvals keep meaning something', async () => {
  const ctx = desktopContext();
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_scroll', { deltaY: 100 });
  assert.notEqual(result.status, 'approval_pending');
  assert.equal(ctx.worker.calls.at(-1).operation.op, 'scroll');
});

test('a stored policy with a non-boolean exposeExecutablePaths falls back to the default instead of being trusted', async () => {
  const ctx = desktopContext({
    yolo: true,
    settingsPolicy: {
      mode: 'allowlist',
      applications: [],
      unattributedInput: 'deny',
      exposeExecutablePaths: 'yes',
    },
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_click', { ref: 'ref_1_1' });
  // If the malformed stored policy were trusted, an empty allowlist would
  // refuse this ordinary notepad.exe window. Falling back to the default
  // (a denylist that permits ordinary apps) instead allows it.
  assert.equal(result.gateVerdict, 'allow');
});

test('desktop_apps returns no apps when no scope is configured (denylist mode)', async () => {
  const ctx = desktopContext({
    settingsPolicy: { mode: 'denylist', applications: [], unattributedInput: 'deny' },
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
  assert.deepEqual(result.apps, []);
  assert.ok(result.note);
  // Denylist mode must never enumerate installed apps toward the model.
  assert.ok(!ctx.worker.calls.some((call: any) => call.operation.kind === 'desktop.apps'));
});

test('desktop_apps resolves the allowlist to name+version, hiding the path by default', async () => {
  const ctx = desktopContext({
    settingsPolicy: { mode: 'allowlist', applications: ['np.exe'], unattributedInput: 'deny' },
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
  assert.deepEqual(result.apps, [{ name: 'Notepad Replacement', version: '2.3.1' }]);
});

test('desktop_apps includes the path when exposeExecutablePaths is true', async () => {
  const ctx = desktopContext({
    settingsPolicy: {
      mode: 'allowlist',
      applications: ['np.exe'],
      unattributedInput: 'deny',
      exposeExecutablePaths: true,
    },
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
  assert.equal(result.apps[0].executablePath, 'C:\\Program Files\\NotepadReplacement\\np.exe');
});

test('desktop_apps falls back to the raw exe basename for an allowlisted app not currently detected', async () => {
  const ctx = desktopContext({
    settingsPolicy: { mode: 'allowlist', applications: ['portable.exe'], unattributedInput: 'deny' },
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
  assert.deepEqual(result.apps, [{ name: 'portable.exe', version: null }]);
});

test('desktop_apps marks its result untrusted, like every other desktop read', async () => {
  // A registry DisplayName is written by whatever installer ran, so it is
  // attacker-influenceable text reaching the model - exactly the reason
  // desktop_windows/describe/capture all mark their results untrusted.
  for (const settingsPolicy of [
    { mode: 'denylist', applications: [], unattributedInput: 'deny' },
    { mode: 'allowlist', applications: ['np.exe'], unattributedInput: 'deny' },
  ]) {
    const ctx = desktopContext({ settingsPolicy });
    const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
    assert.equal(result.untrusted, true, `${settingsPolicy.mode} result was not marked untrusted`);
  }
});

test('desktop_apps DLP-redacts a secret-shaped display name and counts it in the audit row', async () => {
  const secret = createHash('sha256').update('desktop-apps-dlp-fixture').digest('hex');
  const ctx = desktopContext({
    settingsPolicy: { mode: 'allowlist', applications: ['np.exe'], unattributedInput: 'deny' },
    apps: [
      {
        displayName: secret,
        version: '1.0.0',
        executablePath: 'C:\\Program Files\\NotepadReplacement\\np.exe',
        exeBasename: 'np.exe',
      },
    ],
  });
  const result: any = await handleDesktopTool(ctx.value, 's1', 'desktop_apps', {});
  assert.equal(result.apps[0].name, '[REDACTED]');
  const entry = ctx.auditEntries.find((e: any) => e.tool === 'desktop_apps');
  assert.equal(entry.redactionCount, 1);
});
