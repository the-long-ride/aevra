import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOOL_GROUPS,
  RESULT_FORMATS,
  assertToolGroupEnabled,
  isGroupEnabled,
  toolGroupOf,
} from '../src/tool-groups.js';

test('group list and result formats are pinned', () => {
  assert.deepEqual(
    [...TOOL_GROUPS],
    ['files', 'commands', 'git', 'changes', 'skills', 'browser', 'desktop', 'control', 'upstream'],
  );
  assert.deepEqual([...RESULT_FORMATS], ['both', 'text', 'structured']);
});

test('every host tool maps to a group', () => {
  const expected: Record<string, string> = {
    aevra_status: 'core',
    control_access_status: 'core',
    workspace_select: 'core',
    operation_get: 'core',
    approval_wait: 'core',
    search: 'files',
    file_read_many: 'files',
    file_write_many: 'files',
    shell_run: 'commands',
    command_run_many: 'commands',
    process_start: 'commands',
    git_status: 'git',
    change_begin: 'changes',
    skills_list: 'skills',
    skill_read: 'skills',
    instructions_write: 'skills',
    browser_act_many: 'browser',
    desktop_click: 'desktop',
    control_execute: 'control',
    control_plan_status: 'control',
    github__search: 'upstream',
    engram__engram_load: 'upstream',
  };
  for (const [name, group] of Object.entries(expected))
    assert.equal(toolGroupOf(name), group, name);
});

test('core is always enabled; others follow the list; undefined means all', () => {
  assert.equal(isGroupEnabled('core', []), true);
  assert.equal(isGroupEnabled('git', []), false);
  assert.equal(isGroupEnabled('git', ['git']), true);
  assert.equal(isGroupEnabled('browser', undefined), true);
});

test('assertToolGroupEnabled throws TOOL_GROUP_DISABLED for a disabled group', () => {
  assert.doesNotThrow(() => assertToolGroupEnabled('file_list', ['files']));
  assert.doesNotThrow(() => assertToolGroupEnabled('approval_wait', []));
  assert.throws(
    () => assertToolGroupEnabled('git_status', ['files']),
    (error: any) => error.code === 'TOOL_GROUP_DISABLED' && /git/.test(error.message),
  );
});
