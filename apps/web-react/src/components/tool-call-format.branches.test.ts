import { describe, expect, it } from 'vitest';
import {
  extractCommandResults,
  extractCommands,
  parseDetail,
  tailLines,
  unwrapMcpResult,
} from './tool-call-format';

const MARKER = '\n… [truncated]';

describe('parseDetail repair edge cases', () => {
  it('drops a dangling escape when the cut lands inside a string', () => {
    expect(parseDetail(`{"a":"x\\${MARKER}`)).toEqual({
      ok: true,
      value: { a: 'x' },
      truncated: true,
    });
  });
});

describe('unwrapMcpResult', () => {
  it('falls back to structured content when the text part is not JSON', () => {
    expect(
      unwrapMcpResult({
        content: [{ type: 'text', text: 'plain words' }],
        structuredContent: { answer: 1 },
        isError: true,
      }),
    ).toEqual({ data: { answer: 1 }, isError: true });
  });
});

describe('extractCommands rejects malformed inputs', () => {
  it('returns null for a shell_run without a script', () => {
    expect(extractCommands('shell_run', { script: '' })).toBeNull();
  });

  it('returns null when command_run_many has no command array', () => {
    expect(extractCommands('command_run_many', { commands: 'git status' })).toBeNull();
  });

  it('returns null when any batched command is malformed', () => {
    expect(
      extractCommands('command_run_many', { commands: [{ executable: 'git' }, 'not a command'] }),
    ).toBeNull();
  });

  it('returns null for a single command without an executable', () => {
    expect(extractCommands('command_run', { args: ['status'] })).toBeNull();
  });

  it('ignores non-array args', () => {
    expect(extractCommands('command_run', { executable: 'git', args: 'status' })).toEqual([
      { line: 'git' },
    ]);
  });
});

describe('extractCommandResults wrappers and ordering', () => {
  it('describes non-text failures generically', () => {
    expect(extractCommandResults('command_run', { ok: false, error: 42 })).toEqual([
      { error: 'Command failed' },
    ]);
  });

  it('serializes error records that carry no code or message', () => {
    expect(extractCommandResults('command_run', { ok: false, error: { retry: true } })).toEqual([
      { error: '{"retry":true}' },
    ]);
  });

  it('stops unwrapping at an ok wrapper without a value', () => {
    expect(extractCommandResults('command_run', { ok: true })).toBeNull();
  });

  it('orders batched results by index, treating missing indexes as first', () => {
    expect(
      extractCommandResults('command_run_many', {
        results: [{ index: 1, exitCode: 0 }, 'junk', { exitCode: 2 }],
      }),
    ).toEqual([{ error: 'No command result recorded' }, { exitCode: 2 }, { exitCode: 0 }]);
  });
});

describe('tailLines', () => {
  it('treats empty output as zero lines', () => {
    expect(tailLines('', 3)).toEqual({ text: '', hidden: 0, total: 0 });
    expect(tailLines('\n', 3)).toEqual({ text: '', hidden: 0, total: 0 });
  });
});
