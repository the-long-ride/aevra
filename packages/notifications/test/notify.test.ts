import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNotificationCommand, notifySystem } from '../src/notify.js';

describe('system notification command', () => {
  it('uses notify-send on Linux without a shell', () => {
    const command = buildNotificationCommand('linux', 'Approval required', 'git reset --hard');
    assert.deepEqual(command, {
      file: 'notify-send',
      args: ['--app-name=Aevra', 'Approval required', 'git reset --hard'],
    });
  });

  it('uses osascript on macOS and escapes script literals', () => {
    const command = buildNotificationCommand('darwin', 'Aevra "Approval"', 'Switch \\ chat');
    assert.equal(command?.file, 'osascript');
    assert.equal(command?.args[0], '-e');
    assert.match(command?.args[1] ?? '', /display notification/);
    assert.match(command?.args[1] ?? '', /Aevra \\"Approval\\"/);
  });

  it('uses PowerShell toast on Windows with base64 encoded text', () => {
    const command = buildNotificationCommand('win32', 'Approval required', 'sudo command');
    assert.equal(command?.file, 'powershell.exe');
    assert.deepEqual(command?.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.match(command?.args[3] ?? '', /ToastNotificationManager/);
    assert.ok(!(command?.args[3] ?? '').includes('sudo command'));
  });

  it('returns null for unsupported platform', () => {
    assert.equal(buildNotificationCommand('freebsd' as any, 'T', 'M'), null);
  });

  it('notifySystem executes safely on current platform', () => {
    notifySystem('Test title', 'Test message');

    const orig = Object.getOwnPropertyDescriptor(process, 'platform');
    if (orig) {
      Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
      notifySystem('Test', 'Test');
      Object.defineProperty(process, 'platform', orig);
    }
  });
});
