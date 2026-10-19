import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserServiceAdapter, type ServiceIo } from '../src/service/service-manager.js';

function fixture() {
  const commands: { file: string; args: string[] }[] = [];
  const writes: string[] = [];
  const io: ServiceIo = {
    home: '/home/me',
    uid: 1000,
    async run(file, args) {
      commands.push({ file, args });
      return { code: 0, stdout: '', stderr: '' };
    },
    async write(_file, content) {
      writes.push(content);
    },
    async remove() {},
  };
  return { io, commands, writes };
}

test('systemd installed command passes explicit listener flags after start', async () => {
  const state = fixture();
  const service = createUserServiceAdapter('linux', '/usr/bin/node', '/app/aevra.js', state.io, [
    '--gateway-port=9100',
    '--mcp-port=9200',
  ]);
  await service.install();
  assert.match(
    state.writes[0]!,
    /ExecStart=\/usr\/bin\/node \/app\/aevra.js start --gateway-port=9100 --mcp-port=9200\n/,
  );
});

test('LaunchAgent ProgramArguments preserve each explicit listener argument', async () => {
  const state = fixture();
  const service = createUserServiceAdapter('darwin', '/usr/bin/node', '/app/aevra.js', state.io, [
    '--basePort=9100',
  ]);
  await service.install();
  assert.match(
    state.writes[0]!,
    /<string>start<\/string><string>--basePort=9100<\/string><\/array>/,
  );
});

test('scheduled task run command persists explicit listener arguments', async () => {
  const state = fixture();
  const service = createUserServiceAdapter('win32', 'C:\\node.exe', 'C:\\app\\aevra.js', state.io, [
    '--ui-port=9101',
    '--ws-port=9103',
  ]);
  await service.install();
  const args = state.commands[0]!.args;
  assert.equal(
    args[args.indexOf('/TR') + 1],
    '"C:\\node.exe" "C:\\app\\aevra.js" start --ui-port=9101 --ws-port=9103',
  );
});

test('default service definitions retain the existing start command', async () => {
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    const state = fixture();
    await createUserServiceAdapter(platform, '/node', '/aevra.js', state.io).install();
    if (platform === 'linux') assert.match(state.writes[0]!, /ExecStart=\/node \/aevra.js start\n/);
    else if (platform === 'darwin')
      assert.match(state.writes[0]!, /<string>start<\/string><\/array>/);
    else {
      const args = state.commands[0]!.args;
      assert.equal(args[args.indexOf('/TR') + 1], '"/node" "/aevra.js" start');
    }
  }
});
