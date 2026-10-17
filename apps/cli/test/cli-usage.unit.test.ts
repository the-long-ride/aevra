import assert from 'node:assert/strict';
import test from 'node:test';
import * as support from '../src/cli-support.js';
import { agentHelpText, completionText, usageText } from '../src/cli-usage.js';

test('cli-support keeps exporting usage and completion', () => {
  assert.equal(support.usageText, usageText);
  assert.equal(support.completionText, completionText);
});

test('usage is grouped under Run, Connect and Maintain, in that order', () => {
  const usage = usageText();
  const at = ['Run:', 'Connect:', 'Maintain:'].map((heading) => usage.indexOf(`\n${heading}\n`));
  assert.ok(at.every((index) => index > 0));
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
  );
  const group = (name: string) => usage.slice(usage.indexOf(`\n${name}:\n`));
  assert.match(group('Run').split('\nConnect:')[0]!, /aevra start \[--ui\]/);
  assert.match(group('Connect').split('\nMaintain:')[0]!, /aevra agent list\|install\|uninstall/);
  assert.match(group('Connect').split('\nMaintain:')[0]!, /aevra connections list\|revoke <id>/);
  assert.match(group('Maintain'), /aevra backup verify <file>/);
});

test('usage lists agent and uninstall but hides the internal serve command', () => {
  const usage = usageText();
  assert.match(usage, /aevra agent list\|install\|uninstall\|status/);
  assert.match(usage, /aevra agent --help/);
  assert.match(
    usage,
    /aevra uninstall \[--purge\] \[--dry-run\] {2,}remove agent links; --purge also removes service and state/,
  );
  assert.doesNotMatch(usage, /serve/);
  assert.match(usage, /aevra about/);
});

test('agent help documents commands, flags, aliases, examples and the workspace rule', () => {
  const help = agentHelpText();
  for (const needle of [
    'aevra agent list [--json]',
    'aevra agent install [<agent>...|all]',
    'aevra agent uninstall <agent>...|all',
    'aevra agent status [--json]',
    'aevra agent serve --credential-file <file>',
    'claude (alias for claude-code)',
    '--scope user|workspace',
    '--workspace <name|id>',
    '--transport stdio|http',
    '--dry-run',
    '--yes',
    'Examples:',
    'aevra agent install codex claude --workspace Demo',
    'exit code is 1',
    'Giving --workspace to uninstall without --scope means that workspace',
    'it never prompts',
  ]) {
    assert.ok(help.includes(needle), `missing: ${needle}`);
  }
});

test('completion lists agent, connections, uninstall and about in every shell', () => {
  for (const shell of ['bash', 'zsh', 'powershell'] as const) {
    const text = completionText(shell);
    for (const word of ['agent', 'connections', 'uninstall', 'about']) {
      assert.match(text, new RegExp(`\\b${word}\\b`), `${shell} lacks ${word}`);
    }
  }
});
