import assert from 'node:assert/strict';
import test from 'node:test';
import { inputSchemas } from '../src/registry-input-schemas.js';
import { STABLE_TOOL_NAMES, toolDefinitions } from '../src/registry.js';

type StableToolName = (typeof STABLE_TOOL_NAMES)[number];

const READ_ONLY_TOOLS = [
  'aevra_status',
  'workspace_list',
  'workspace_select',
  'workspace_current',
  'file_list',
  'file_read_many',
  'file_search',
  'process_list',
  'process_status',
  'process_wait',
  'process_logs',
  'desktop_status',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
] as const satisfies readonly StableToolName[];

const MUTATING_TOOLS = [
  'file_write_many',
  'command_run_many',
  'shell_run',
  'process_start',
  'process_stop',
  'process_restart',
  'git_push',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
] as const satisfies readonly StableToolName[];

test('stable tool vocabulary includes read and policy tools but no root mutation', () => {
  for (const name of [
    'aevra_status',
    'workspace_select',
    'file_read',
    'file_read_many',
    'approval_wait',
    'change_rollback',
    'shell_run',
    'process_status',
    'process_wait',
  ] as const satisfies readonly StableToolName[]) {
    assert.ok(STABLE_TOOL_NAMES.includes(name));
  }

  for (const name of ['workspace_add', 'workspace_remove', 'mount_add', 'mount_remove']) {
    assert.equal(STABLE_TOOL_NAMES.includes(name as StableToolName), false);
  }
});

test('workspace file and process inspection tools are explicitly read-only', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));

  for (const name of READ_ONLY_TOOLS) {
    const tool = definitions.get(name);
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(tool.annotations?.readOnlyHint, true, `${name} must be read-only`);
    assert.equal(tool.annotations?.openWorldHint, false, `${name} stays inside Aevra state`);
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
  const fileReadMany = definitions.get('file_read_many')?.inputSchema as any;
  const fileSearch = definitions.get('file_search')?.inputSchema as any;
  const readItem = fileReadMany?.properties?.reads?.items;
  assert.equal(workspaceSelect?.type, 'object');
  assert.ok(workspaceSelect?.properties?.workspace, 'workspace_select.workspace schema missing');
  assert.equal(
    fileReadMany?.required?.includes('reads'),
    true,
    'file_read_many.reads must be required',
  );
  assert.equal(
    readItem?.required?.includes('path'),
    true,
    'file_read_many reads[].path is required',
  );
  assert.ok(readItem?.properties?.path, 'file_read_many reads[].path schema missing');
  assert.equal(fileSearch?.required?.includes('query'), true, 'file_search.query must be required');
  assert.ok(fileSearch?.properties?.query, 'file_search.query schema missing');
});

test('process tools publish closed inputs and terminal output schemas', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of [
    'process_start',
    'process_list',
    'process_status',
    'process_wait',
    'process_logs',
    'process_stop',
    'process_restart',
  ] as const) {
    const tool = definitions.get(name) as any;
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${name} input must be closed`);
    assert.ok(tool.outputSchema, `${name} output schema missing`);
  }

  const start = definitions.get('process_start') as any;
  assert.ok(start.inputSchema.properties.name, 'process_start.name schema missing');

  const status = definitions.get('process_status') as any;
  assert.deepEqual(status.inputSchema.required, ['processId']);
  assert.ok(status.outputSchema.properties.state);
  assert.ok(status.outputSchema.properties.exitCode);
  assert.ok(status.outputSchema.properties.finishedAt);

  const wait = definitions.get('process_wait') as any;
  assert.deepEqual(wait.inputSchema.required, ['processId']);
  assert.equal(wait.inputSchema.properties.timeoutMs.maximum, 30000);
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

test('browser_act_many advertises both canonical and nested click actions', () => {
  const schema = inputSchemas.browser_act_many as any;
  const variants = schema.properties.actions.items.oneOf as any[];
  assert.ok(Array.isArray(variants), 'actions must publish concrete variants');
  assert.ok(variants.some((variant) => variant.properties?.op?.const === 'click'));
  assert.ok(variants.some((variant) => variant.required?.includes('click')));
  assert.ok(variants.every((variant) => variant.additionalProperties === false));
});

test('browser tool metadata guides models from semantic targets to coordinate fallback', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  const snapshot = definitions.get('browser_snapshot') as any;
  const actions = definitions.get('browser_act_many') as any;
  const script = definitions.get('browser_execute_script') as any;

  assert.match(snapshot.description, /accessibility.*first/i);
  assert.match(snapshot.description, /vision.*canvas/i);
  assert.match(snapshot.inputSchema.properties.mode.description, /accessibility.*first/i);
  assert.match(actions.description, /ref.*selector.*coordinate/i);
  assert.match(actions.description, /canvas|semantic.*fail/i);
  assert.match(actions.inputSchema.properties.actions.description, /ref.*selector.*coordinate/i);
  assert.match(actions.inputSchema.properties.actions.description, /last resort/i);
  assert.match(script.description, /stable.*selector/i);
});

test('browser_act_many exposes flat and nested drag actions with both endpoints required', () => {
  const schema = inputSchemas.browser_act_many as any;
  const variants = schema.properties.actions.items.oneOf as any[];
  const flat = variants.find((variant) => variant.properties?.op?.const === 'drag');
  const nested = variants.find((variant) => variant.properties?.drag);
  for (const payload of [flat, nested?.properties?.drag]) {
    assert.ok(payload, 'drag variant missing');
    for (const field of ['x', 'y', 'toX', 'toY']) {
      assert.ok(payload.required.includes(field), `${field} must be required`);
      assert.equal(payload.properties[field].type, 'number');
    }
    assert.equal(payload.additionalProperties, false);
  }
});

test('command, shell, and process inputs publish cwdLogical', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  const command = inputSchemas.command_run as any;
  const shell = definitions.get('shell_run')?.inputSchema as any;
  const process = definitions.get('process_start')?.inputSchema as any;

  assert.ok(command?.properties?.cwdLogical, 'command_run.cwdLogical schema missing');
  assert.ok(
    command?.properties?.command?.properties?.cwdLogical,
    'nested command cwdLogical schema missing',
  );
  assert.ok(shell?.properties?.cwdLogical, 'shell_run.cwdLogical schema missing');
  assert.ok(process?.properties?.cwdLogical, 'process_start.cwdLogical schema missing');
  const commandMany = definitions.get('command_run_many')?.inputSchema as any;
  assert.ok(
    commandMany?.properties?.commands?.items?.properties?.cwdLogical,
    'command_run_many commands[].cwdLogical schema missing',
  );
  assert.ok(
    commandMany?.properties?.commands?.items?.properties?.command?.properties?.cwdLogical,
    'nested command_run_many cwdLogical schema missing',
  );
});

test('workspace-scoped public tools accept explicit workspace name or ID', () => {
  const definitions = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of [
    'file_read_many',
    'git_status',
    'command_run_many',
    'process_list',
    'change_begin',
  ] as const) {
    const schema = definitions.get(name)?.inputSchema as any;
    assert.ok(schema?.properties?.workspace, `${name} workspace schema missing`);
    assert.ok(schema?.properties?.workspaceId, `${name} workspaceId schema missing`);
  }
});

test('device control tools publish host scope and ignored legacy workspace fields', () => {
  const definitions = new Map<string, ReturnType<typeof toolDefinitions>[number]>(
    toolDefinitions().map((tool) => [tool.name, tool]),
  );
  const access = definitions.get('control_access_status') as any;
  assert.ok(access);
  assert.deepEqual(access.inputSchema.required ?? [], []);
  for (const name of ['browser_status', 'desktop_status', 'control_observe', 'control_execute']) {
    const tool = definitions.get(name) as any;
    assert.ok(tool);
    assert.match(tool.inputSchema.properties.workspaceId.description, /ignored for host/i);
    assert.equal(tool.inputSchema.required?.includes('workspaceId') ?? false, false);
  }
});
