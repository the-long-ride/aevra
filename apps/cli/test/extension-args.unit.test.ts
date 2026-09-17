import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAevraArgs } from '../src/args.js';
import { completionText, usageText } from '../src/cli-support.js';

test('extension install parses with no options', () => {
  assert.deepEqual(parseAevraArgs(['extension', 'install']), {
    command: 'extension',
    action: 'install',
    yes: false,
  });
});

test('extension install takes a target directory and a confirmation', () => {
  assert.deepEqual(parseAevraArgs(['extension', 'install', '--dir', '/opt/aevra', '--yes']), {
    command: 'extension',
    action: 'install',
    dir: '/opt/aevra',
    yes: true,
  });
});

test('option order does not matter', () => {
  assert.deepEqual(parseAevraArgs(['extension', 'install', '--yes', '--dir', '/opt/aevra']), {
    command: 'extension',
    action: 'install',
    dir: '/opt/aevra',
    yes: true,
  });
});

test('--dir without a value is refused rather than swallowing the next flag', () => {
  assert.throws(() => parseAevraArgs(['extension', 'install', '--dir']), /--dir requires a path/);
  assert.throws(
    () => parseAevraArgs(['extension', 'install', '--dir', '--yes']),
    /--dir requires a path/,
  );
});

test('an unknown extension action or option is refused', () => {
  assert.throws(() => parseAevraArgs(['extension']), /extension requires install/);
  assert.throws(() => parseAevraArgs(['extension', 'remove']), /extension requires install/);
  assert.throws(
    () => parseAevraArgs(['extension', 'install', '--force']),
    /Unknown extension option: --force/,
  );
});

test('the command is discoverable from usage and completions', () => {
  assert.match(usageText(), /aevra extension install/);
  for (const shell of ['bash', 'zsh', 'powershell'] as const) {
    assert.match(completionText(shell), /extension/);
  }
});
