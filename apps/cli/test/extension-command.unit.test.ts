import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  runExtensionCommand,
  type ExtensionCommandDependencies,
} from '../src/commands/extension-command.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A store-only archive, matching what the packaging script publishes. */
function zipOf(files: Array<[string, string]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(body, 'utf8');
    const checksum = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

const ARCHIVE = zipOf([
  ['aevra-extension/manifest.json', '{"manifest_version":3}'],
  ['aevra-extension/apps/extension/src/service-worker.js', 'sw'],
]);

function harness(overrides: Partial<ExtensionCommandDependencies> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const written: Array<[string, string]> = [];
  const removed: string[] = [];
  const asked: string[] = [];
  const downloaded: string[] = [];

  const dependencies: ExtensionCommandDependencies = {
    version: '9.9.9',
    async download(url) {
      downloaded.push(url);
      return ARCHIVE;
    },
    async ask(question, fallback) {
      asked.push(question);
      return fallback;
    },
    isInteractive: () => true,
    defaultDirectory: () => path.resolve('/state/browser'),
    hasContents: () => false,
    remove: (directory) => removed.push(directory),
    writeEntry: (file, data) => written.push([file, String(data)]),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    formatError: (error) => (error instanceof Error ? error.message : String(error)),
    ...overrides,
  };

  return { dependencies, logs, errors, written, removed, asked, downloaded };
}

const INSTALL = { command: 'extension', action: 'install', yes: false } as const;

test('a named directory skips the prompt and unzips into it', async () => {
  const state = harness();
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra') },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.asked, []);
  assert.deepEqual(
    state.written.map(([file]) => file).sort(),
    [
      path.resolve('/opt/aevra/aevra-extension/apps/extension/src/service-worker.js'),
      path.resolve('/opt/aevra/aevra-extension/manifest.json'),
    ].sort(),
  );
});

test('it asks for the version it is running, not for whatever is latest', async () => {
  const state = harness();
  await runExtensionCommand({ ...INSTALL, dir: path.resolve('/opt/aevra') }, state.dependencies);
  assert.deepEqual(state.downloaded, [
    'https://github.com/the-long-ride/aevra/releases/download/v9.9.9/aevra-extension.zip',
  ]);
});

test('with no directory it asks, and an empty answer takes the default', async () => {
  const state = harness({ ask: async (_question, fallback) => fallback });
  const code = await runExtensionCommand(INSTALL, state.dependencies);

  assert.equal(code, 0);
  assert.ok(
    state.written.every(([file]) => file.startsWith(path.resolve('/state/browser'))),
    'entries must land under the offered default',
  );
});

test('a typed answer is used instead of the default', async () => {
  const state = harness({ ask: async () => path.resolve('/elsewhere') });
  await runExtensionCommand(INSTALL, state.dependencies);
  assert.ok(state.written.every(([file]) => file.startsWith(path.resolve('/elsewhere'))));
});

test('surrounding whitespace in the answer is trimmed', async () => {
  const state = harness({ ask: async () => `  ${path.resolve('/elsewhere')}  ` });
  await runExtensionCommand(INSTALL, state.dependencies);
  assert.ok(state.written.every(([file]) => file.startsWith(path.resolve('/elsewhere'))));
});

test('with no terminal to ask on it refuses rather than picking for the user', async () => {
  const state = harness({ isInteractive: () => false });
  const code = await runExtensionCommand(INSTALL, state.dependencies);

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /needs --dir/);
  assert.deepEqual(state.downloaded, [], 'nothing should be downloaded before a target is known');
  assert.deepEqual(state.written, []);
});

test('an occupied target is left alone unless replacing it was asked for', async () => {
  const state = harness({ hasContents: () => true });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra') },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /already has files in it. Re-run with --yes/);
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.written, []);
  assert.deepEqual(state.downloaded, []);
});

test('--yes replaces the folder, and says which one', async () => {
  const state = harness({ hasContents: () => true });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra'), yes: true },
    state.dependencies,
  );

  assert.equal(code, 0);
  assert.deepEqual(state.removed, [path.resolve('/opt/aevra/aevra-extension')]);
  assert.equal(state.written.length, 2);
});

test('a failed download leaves an existing install in place', async () => {
  const state = harness({
    hasContents: () => true,
    download: async () => {
      throw new Error('connection reset');
    },
  });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra'), yes: true },
    state.dependencies,
  );

  assert.equal(code, 1);
  // Removing first would have left the user with no extension and, because the
  // id is bound to the folder, an unpaired browser.
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.written, []);
});

test('a hostile archive leaves an existing install in place', async () => {
  const hostile = zipOf([
    ['aevra-extension/manifest.json', '{}'],
    ['../../../etc/cron.d/aevra', 'pwned'],
  ]);
  const state = harness({ hasContents: () => true, download: async () => hostile });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra'), yes: true },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.written, []);
});

test('the download is refused before the folder is touched when --yes is missing', async () => {
  const state = harness({ hasContents: () => true });
  await runExtensionCommand({ ...INSTALL, dir: path.resolve('/opt/aevra') }, state.dependencies);
  assert.deepEqual(state.downloaded, []);
  assert.deepEqual(state.removed, []);
});

test('a traversing archive writes nothing at all', async () => {
  const hostile = zipOf([
    ['aevra-extension/manifest.json', '{}'],
    ['../../../etc/cron.d/aevra', 'pwned'],
  ]);
  const state = harness({ download: async () => hostile });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra') },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /escapes the destination/);
  // The whole archive is validated before any of it is written, so a hostile
  // entry cannot leave a half-extracted tree behind.
  assert.deepEqual(state.written, []);
});

test('a failed download reports why and writes nothing', async () => {
  const state = harness({
    download: async () => {
      throw new Error('No extension archive is published for Aevra 9.9.9');
    },
  });
  const code = await runExtensionCommand(
    { ...INSTALL, dir: path.resolve('/opt/aevra') },
    state.dependencies,
  );

  assert.equal(code, 1);
  assert.match(state.errors[0]!, /No extension archive is published for Aevra 9\.9\.9/);
  assert.deepEqual(state.written, []);
});

test('it explains how to load the folder and why it must stay put', async () => {
  const state = harness();
  await runExtensionCommand({ ...INSTALL, dir: path.resolve('/opt/aevra') }, state.dependencies);
  const output = state.logs.join('\n');

  assert.match(output, /chrome:\/\/extensions/);
  assert.match(output, /Developer mode/);
  assert.match(output, /Load unpacked/);
  assert.ok(output.includes(path.resolve('/opt/aevra/aevra-extension')));
  // The id of an unpacked extension comes from its path, so moving the folder
  // silently unpairs the browser. Saying so is part of the install.
  assert.match(output, /moving it changes the extension id/);
  assert.match(output, /Pair extension/);
});
