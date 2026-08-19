import assert from 'node:assert/strict';
import test from 'node:test';
import { STABLE_TOOL_NAMES, toolDefinitions } from '../src/registry.js';

type StableToolName = (typeof STABLE_TOOL_NAMES)[number];

const READ_ONLY_TOOLS = [
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read',
  'file_search',
] as const satisfies readonly StableToolName[];

const MUTATING_TOOLS = [
  'file_write',
  'command_run',
  'shell_run',
  'git_push',
] as const satisfies readonly StableToolName[];

test('stable tool vocabulary includes read and policy tools but no root mutation', () => {
  for (const name of [
    'aevra_status',
    'workspace_select',
    'file_read',
    'approval_wait',
    'change_rollback',
    'shell_run',
  ] as const satisfies readonly StableToolName[]) {
    assert.ok(STABLE_TOOL_NAMES.includes(name));
  }

  for (const name of ['workspace_add', 'workspace_remove', 'mount_add', 'mount_remove']) {
    assert.equal(STABLE_TOOL_NAMES.includes(name as StableToolName), false);
  }
});

test('workspace and file discovery tools are explicitly read-only for ChatGPT filtering', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));

  for (const name of READ_ONLY_TOOLS) {
    const tool = definitions.get(name);
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(
      tool.annotations?.readOnlyHint,
      true,
      `${name} must be discoverable in read-only MCP contexts`,
    );
    assert.equal(
      tool.annotations?.openWorldHint,
      false,
      `${name} stays inside Aevra/local workspace state`,
    );
  }

  for (const name of MUTATING_TOOLS) {
    assert.notEqual(
      definitions.get(name)?.annotations?.readOnlyHint,
      true,
      `${name} must not be presented as read-only`,
    );
  }
});

test('workspace and file read tools publish concrete input schemas', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  const workspaceSelect = definitions.get('workspace_select')?.inputSchema as any;
  const fileRead = definitions.get('file_read')?.inputSchema as any;
  const fileSearch = definitions.get('file_search')?.inputSchema as any;
  assert.equal(workspaceSelect?.type, 'object');
  assert.ok(workspaceSelect?.properties?.workspace, 'workspace_select.workspace schema missing');
  assert.equal(fileRead?.required?.includes('path'), true, 'file_read.path must be required');
  assert.ok(fileRead?.properties?.path, 'file_read.path schema missing');
  assert.equal(fileSearch?.required?.includes('query'), true, 'file_search.query must be required');
  assert.ok(fileSearch?.properties?.query, 'file_search.query schema missing');
});

test('shell_run publishes a concrete high-control script schema', () => {
  const shell = toolDefinitions().find((tool) => tool.name === 'shell_run') as any;
  assert.ok(shell, 'shell_run descriptor missing');
  assert.equal(shell.inputSchema.required.includes('script'), true);
  assert.deepEqual(shell.inputSchema.properties.shell.enum, ['auto', 'powershell', 'bash', 'sh']);
  assert.deepEqual(shell.inputSchema.properties.executionMode.enum, ['sandbox', 'host']);
  assert.equal(shell.annotations.openWorldHint, true);
  assert.equal(shell.annotations.readOnlyHint, false);
});
