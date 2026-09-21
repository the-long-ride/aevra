import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAboutOutput, runAboutCommand } from '../src/commands/about-command.js';

test('formatAboutOutput includes author, repository, and issue links formatted as table without note line', () => {
  const output = formatAboutOutput('1.1.0');
  assert.match(output, /the-long-ride/);
  assert.equal(output.includes('make by'), false);
  assert.equal(output.includes('made by'), false);
  assert.match(output, /https:\/\/github\.com\/the-long-ride/);
  assert.match(output, /https:\/\/github\.com\/the-long-ride\/aevra/);
  assert.match(output, /https:\/\/github\.com\/the-long-ride\/aevra\/issues/);
  assert.match(output, /v1\.1\.0/);
  assert.match(output, /Workspace-scoped local MCP execution gateway/);
  assert.match(output, /┌[─┬]+┐/);
  assert.match(output, /└[─┴]+┘/);
});

test('runAboutCommand logs formatted about message and exits 0', () => {
  const logs: string[] = [];
  const code = runAboutCommand({ command: 'about' }, { log: (msg) => logs.push(msg) });
  assert.equal(code, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /the-long-ride/);
  assert.equal(logs[0]!.includes('make by'), false);
  assert.equal(logs[0]!.includes('made by'), false);
  assert.match(logs[0]!, /https:\/\/github\.com\/the-long-ride\/aevra/);
});
