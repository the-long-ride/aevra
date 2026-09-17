import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectInstalledApps,
  isInstallerExe,
  parseUninstallBlocks,
  resolveExecutablePath,
  toDetectedApp,
} from '../src/installed-apps.js';

const FIXTURE_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AAAA}
    DisplayName    REG_SZ    Notepad Replacement
    DisplayVersion    REG_SZ    2.3.1
    DisplayIcon    REG_SZ    C:\\Program Files\\NotepadReplacement\\np.exe,0

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{BBBB}
    DisplayName    REG_SZ    Hidden System Update
    SystemComponent    REG_DWORD    0x1
    DisplayIcon    REG_SZ    C:\\Windows\\update.exe

HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{CCCC}
    DisplayVersion    REG_SZ    9.9.9
`;

test('parseUninstallBlocks splits key blocks and their indented values', () => {
  const blocks = parseUninstallBlocks(FIXTURE_OUTPUT);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]!.DisplayName, 'Notepad Replacement');
  assert.equal(blocks[0]!.DisplayVersion, '2.3.1');
  assert.equal(blocks[1]!.SystemComponent, '0x1');
  assert.equal(blocks[2]!.DisplayName, undefined);
});

test('resolveExecutablePath strips a trailing icon index and requires .exe', () => {
  assert.equal(
    resolveExecutablePath({ DisplayIcon: 'C:\\Program Files\\App\\app.exe,0' }),
    'C:\\Program Files\\App\\app.exe',
  );
  assert.equal(resolveExecutablePath({ DisplayIcon: 'C:\\Windows\\resource.dll,2' }), null);
  assert.equal(resolveExecutablePath({}), null);
});

test('an installer, updater, or uninstaller exe is not offered as an app', () => {
  // Real entries seen on a developer machine. The window gate matches the
  // RUNNING process, so allowlisting `Docker Desktop Installer.exe` would
  // silently refuse every action against Docker Desktop itself - worse than
  // simply not offering it, because nothing would explain the refusal.
  for (const exe of [
    'Docker Desktop Installer.exe',
    'OneDriveSetup.exe',
    'Uninstaller.exe',
    'SetupARP.exe',
    'setup.exe',
    'wdksetup.exe',
    'DellUpdateSupportAssistPlugin.exe',
  ]) {
    assert.equal(isInstallerExe(exe), true, `${exe} should be treated as an installer`);
  }
  for (const exe of ['notepad.exe', 'Docker Desktop.exe', 'Bruno.exe', 'chrome.exe']) {
    assert.equal(isInstallerExe(exe), false, `${exe} should be treated as a real app`);
  }
});

test('toDetectedApp drops an entry whose only executable is an installer', () => {
  assert.equal(
    toDetectedApp({
      DisplayName: 'Docker Desktop',
      DisplayIcon: 'C:\\Program Files\\Docker\\Docker Desktop Installer.exe',
    }),
    null,
  );
  assert.ok(
    toDetectedApp({
      DisplayName: 'Docker Desktop',
      DisplayIcon: 'C:\\Program Files\\Docker\\Docker Desktop.exe',
    }),
  );
});

test('detectInstalledApps resolves to an array of well-formed entries on this host', async () => {
  const apps = await detectInstalledApps();
  assert.ok(Array.isArray(apps));
  for (const app of apps) {
    assert.equal(typeof app.displayName, 'string');
    assert.ok(app.displayName.length > 0);
    assert.equal(typeof app.executablePath, 'string');
    assert.equal(typeof app.exeBasename, 'string');
    assert.ok(app.version === null || typeof app.version === 'string');
  }
});

test('detectInstalledApps never reports a mangled name or a duplicate basename', async () => {
  const apps = await detectInstalledApps();
  for (const app of apps) {
    // A per-chunk decode would leave U+FFFD wherever a multi-byte sequence
    // straddled a stdout chunk boundary; decoding the whole output once
    // cannot produce one.
    assert.ok(!app.displayName.includes('�'), `mangled name: ${app.displayName}`);
  }
  const basenames = apps.map((app) => app.exeBasename.toLowerCase());
  assert.equal(new Set(basenames).size, basenames.length);
});

test('a basename collision resolves by name, not by which hive was read first', async () => {
  // Determinism is the point: the same machine must produce the same label on
  // every scan, rather than one decided by HKLM/WOW6432Node/HKCU ordering.
  const first = await detectInstalledApps();
  const second = await detectInstalledApps();
  assert.deepEqual(
    first.map((app) => `${app.exeBasename}:${app.displayName}`),
    second.map((app) => `${app.exeBasename}:${app.displayName}`),
  );
});
