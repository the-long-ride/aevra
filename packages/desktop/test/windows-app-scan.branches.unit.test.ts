import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectRegistryCatalogApps } from '../src/installed-apps.js';
import {
  canonicalAppPath,
  catalogApp,
  catalogAppsFromRows,
  expandWindowsEnvironmentVariables,
  readPowerShellRows,
  verifiedExecutablePath,
} from '../src/windows-app-scan.js';

const WIN = process.platform === 'win32';

test('readPowerShellRows reports a non-Windows host', { skip: WIN }, async () => {
  assert.deepEqual(await readPowerShellRows('Sample', 'x'), {
    rows: [],
    warnings: ['Sample discovery requires a Windows host'],
  });
});

test('readPowerShellRows parses arrays, envelopes, single values and empty output', { skip: !WIN }, async () => {
  const list = await readPowerShellRows('S', `Write-Output '[{"displayName":"A"},{"displayName":"B"}]'`);
  assert.deepEqual(list, { rows: [{ displayName: 'A' }, { displayName: 'B' }], warnings: [] });
  const envelope = await readPowerShellRows(
    'S',
    `Write-Output '{"rows":{"displayName":"one"},"warnings":["w1","w1",5]}'`,
  );
  assert.deepEqual(envelope, { rows: [{ displayName: 'one' }], warnings: ['w1'] });
  assert.deepEqual(await readPowerShellRows('S', '$null'), { rows: [], warnings: [] });
  assert.deepEqual(await readPowerShellRows('S', `Write-Output 'null'`), { rows: [], warnings: [] });
  const fromEnv = await readPowerShellRows('S', 'Write-Output $env:AEVRA_SAMPLE_ROW', {
    AEVRA_SAMPLE_ROW: '{"displayName":"env row"}',
  });
  assert.deepEqual(fromEnv.rows, [{ displayName: 'env row' }]);
});

test('readPowerShellRows turns failures into warnings', { skip: !WIN }, async () => {
  assert.deepEqual(await readPowerShellRows('S', `Write-Output 'not json'`), {
    rows: [],
    warnings: ['S discovery returned unreadable results'],
  });
  assert.deepEqual(await readPowerShellRows('S', 'exit 3'), {
    rows: [],
    warnings: ['S discovery returned incomplete results'],
  });
  const many = await readPowerShellRows(
    'S',
    'ConvertTo-Json -Compress @(1..501 | ForEach-Object { @{ displayName = "n$_" } })',
  );
  assert.equal(many.rows.length, 500);
  assert.deepEqual(many.warnings, ['S discovery reached the 500 app limit']);
  const oversized = await readPowerShellRows('S', `Write-Output ('x' * 3000000)`);
  assert.deepEqual(oversized.warnings, ['S discovery exceeded the output limit']);
});

test('readPowerShellRows needs a Windows directory that holds PowerShell', { skip: !WIN }, async () => {
  const saved = { root: process.env.SystemRoot, dir: process.env.WINDIR };
  try {
    delete process.env.SystemRoot;
    delete process.env.WINDIR;
    assert.deepEqual((await readPowerShellRows('S', 'x')).warnings, [
      'S discovery could not locate Windows PowerShell',
    ]);
    process.env.SystemRoot = path.join(os.tmpdir(), 'aevra-no-windows-dir');
    assert.deepEqual((await readPowerShellRows('S', 'x')).warnings, ['S discovery could not start']);
  } finally {
    process.env.SystemRoot = saved.root;
    process.env.WINDIR = saved.dir;
  }
});

test('environment expansion resolves known names and rejects unknown ones', () => {
  process.env.AEVRA_SAMPLE_DIR = 'C:\\Sample';
  try {
    assert.equal(expandWindowsEnvironmentVariables('%AEVRA_SAMPLE_DIR%\\a.exe'), 'C:\\Sample\\a.exe');
    assert.equal(expandWindowsEnvironmentVariables('%AEVRA_UNSET_NAME_1%\\a.exe'), undefined);
    assert.equal(expandWindowsEnvironmentVariables('plain'), 'plain');
  } finally {
    delete process.env.AEVRA_SAMPLE_DIR;
  }
});

test('verified paths and catalog rows classify real, installer, runtime and invalid entries', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aevra-appscan-'));
  try {
    const app = path.join(dir, 'app.exe');
    const setup = path.join(dir, 'setup.exe');
    const webview = path.join(dir, 'msedgewebview2.exe');
    const text = path.join(dir, 'notes.txt');
    for (const file of [app, setup, webview, text]) writeFileSync(file, 'sample');
    mkdirSync(path.join(dir, 'folder.exe'));

    assert.equal(await verifiedExecutablePath(5), undefined);
    assert.equal(await verifiedExecutablePath('   '), undefined);
    assert.equal(await verifiedExecutablePath('relative.exe'), undefined);
    assert.equal(await verifiedExecutablePath(text), undefined);
    assert.equal(await verifiedExecutablePath(path.join(dir, 'folder.exe')), undefined);
    assert.equal(await verifiedExecutablePath(path.join(dir, 'missing.exe')), undefined);
    assert.equal(await verifiedExecutablePath('%AEVRA_UNSET_NAME_2%\\x.exe'), undefined);
    assert.ok((await verifiedExecutablePath(app))?.toLowerCase().endsWith('app.exe'));

    const apps = await catalogAppsFromRows(
      [
        { displayName: ' App ', version: '1.0', executablePath: app },
        { displayName: 'Installer', version: '', executablePath: setup },
        { displayName: 'Runtime', executablePath: webview },
        { displayName: '  ' },
        { displayName: 7 },
      ],
      'registry' as any,
    );
    assert.deepEqual(
      apps.map((entry) => [entry.displayName, entry.version, entry.grantable, entry.reason ?? null]),
      [
        ['App', '1.0', true, null],
        ['Installer', null, false, 'needs-manual-path'],
        ['Runtime', null, false, 'shared-runtime'],
      ],
    );
    assert.equal(apps[0]!.exeBasename, 'app.exe');
    assert.equal(apps[2]!.exeBasename, 'msedgewebview2.exe');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const manual = catalogApp({ displayName: 'X' }, 'registry' as any, undefined, 'shared-runtime');
  assert.equal(manual?.reason, 'shared-runtime');
  assert.equal(canonicalAppPath('C:/Apps/One.exe'), canonicalAppPath('C:\\Apps\\One.exe'));
});

test('registry catalog discovery returns well-formed rows or a host warning', async () => {
  const scan = await detectRegistryCatalogApps();
  if (!WIN) {
    assert.deepEqual(scan, { apps: [], warnings: ['Registry discovery requires a Windows host'] });
    return;
  }
  assert.ok(Array.isArray(scan.warnings));
  for (const entry of scan.apps) {
    assert.ok(entry.displayName.length > 0);
    assert.deepEqual(entry.sources, ['registry']);
    if (entry.grantable) assert.ok(entry.executablePath?.toLowerCase().endsWith('.exe'));
    else assert.ok(entry.reason);
  }
});
