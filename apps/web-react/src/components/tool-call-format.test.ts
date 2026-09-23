import { describe, expect, test } from 'vitest';
import {
  extractCommandResults,
  extractCommands,
  parseDetail,
  tailLines,
  unwrapMcpResult,
} from './tool-call-format';

describe('parseDetail', () => {
  test('returns undefined when nothing was recorded', () => {
    expect(parseDetail(undefined)).toBeUndefined();
  });

  test('parses complete JSON', () => {
    expect(parseDetail('{"path":"README.md"}')).toEqual({
      ok: true,
      value: { path: 'README.md' },
      truncated: false,
    });
  });

  test('keeps non-JSON text as text', () => {
    expect(parseDetail('plain failure text')).toEqual({
      ok: false,
      text: 'plain failure text',
      truncated: false,
    });
  });

  test('repairs JSON cut by the server truncation marker', () => {
    const raw = '{\n  "stdout": "line one\\nline tw\n… [truncated]';
    expect(parseDetail(raw)).toEqual({
      ok: true,
      value: { stdout: 'line one\nline tw' },
      truncated: true,
    });
  });

  test('drops a dangling escape and trailing comma when repairing', () => {
    const raw = '{"a": [1, 2,\n… [truncated]';
    expect(parseDetail(raw)).toEqual({ ok: true, value: { a: [1, 2] }, truncated: true });
    const escaped = '{"a": "x\\\n… [truncated]';
    expect(parseDetail(escaped)).toEqual({ ok: true, value: { a: 'x' }, truncated: true });
  });

  test('falls back to text when truncated JSON cannot be repaired', () => {
    const raw = '{"a": 1, "ke\n… [truncated]';
    expect(parseDetail(raw)).toEqual({ ok: false, text: '{"a": 1, "ke', truncated: true });
  });
});

describe('unwrapMcpResult', () => {
  test('prefers the parsed text content of an MCP tool result', () => {
    const result = {
      content: [{ type: 'text', text: '{"exitCode":0,"stdout":"ok"}' }],
      structuredContent: { exitCode: 0, stdout: 'ok' },
    };
    expect(unwrapMcpResult(result)).toEqual({
      data: { exitCode: 0, stdout: 'ok' },
      isError: false,
    });
  });

  test('falls back to structuredContent when the text content is unusable', () => {
    const result = {
      content: [{ type: 'text', text: '{"exitCode":0,"std' }],
      structuredContent: { exitCode: 0 },
    };
    expect(unwrapMcpResult(result).data).toEqual({ exitCode: 0 });
  });

  test('flags MCP error results', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: '{"error":{"code":"DENIED","message":"No"}}' }],
    };
    expect(unwrapMcpResult(result)).toEqual({
      data: { error: { code: 'DENIED', message: 'No' } },
      isError: true,
    });
  });

  test('keeps plain text content as a string', () => {
    const result = { content: [{ type: 'text', text: 'hello' }] };
    expect(unwrapMcpResult(result).data).toBe('hello');
  });

  test('returns values that are not MCP envelopes unchanged', () => {
    expect(unwrapMcpResult({ content: '[REDACTED]' })).toEqual({
      data: { content: '[REDACTED]' },
      isError: false,
    });
  });
});

describe('extractCommands', () => {
  test('joins executable and args, quoting args with spaces', () => {
    expect(
      extractCommands('command_run', {
        executable: 'git',
        args: ['commit', '-m', 'fix: tidy up'],
        cwdLogical: '/apps',
        executionMode: 'host',
        timeoutMs: 5000,
      }),
    ).toEqual([
      {
        line: 'git commit -m "fix: tidy up"',
        cwd: '/apps',
        mode: 'host',
        timeoutMs: 5000,
      },
    ]);
  });

  test('normalizes every command_run_many item including the nested form', () => {
    expect(
      extractCommands('command_run_many', {
        commands: [
          { executable: 'npm', args: ['test'] },
          { command: { executable: 'node', args: ['-v'], cwdLogical: '/x' } },
        ],
      }),
    ).toEqual([{ line: 'npm test' }, { line: 'node -v', cwd: '/x' }]);
  });

  test('shows shell_run scripts with their interpreter', () => {
    expect(extractCommands('shell_run', { script: 'ls -la', shell: 'bash' })).toEqual([
      { line: 'ls -la', shell: 'bash' },
    ]);
  });

  test('returns null for tools that do not run commands', () => {
    expect(extractCommands('file_read_many', { reads: [] })).toBeNull();
    expect(extractCommands('command_run', 'oops')).toBeNull();
  });
});

describe('extractCommandResults', () => {
  test('reads a single command result', () => {
    expect(
      extractCommandResults('shell_run', {
        exitCode: 1,
        stdout: '',
        stderr: 'boom',
        durationMs: 9,
      }),
    ).toEqual([{ exitCode: 1, stdout: '', stderr: 'boom', durationMs: 9 }]);
  });

  test('reads command_run_many results and failed children', () => {
    expect(
      extractCommandResults('command_run_many', {
        results: [
          { index: 0, ok: true, value: { exitCode: 0, stdout: 'ok', timedOut: false } },
          { index: 1, ok: false, error: { code: 'DENIED', message: 'Not allowed' } },
        ],
      }),
    ).toEqual([{ exitCode: 0, stdout: 'ok', timedOut: false }, { error: 'DENIED: Not allowed' }]);
  });

  test('turns a tool error envelope into an error result', () => {
    expect(
      extractCommandResults('command_run', { error: { code: 'TIMEOUT', message: 'Too slow' } }),
    ).toEqual([{ error: 'TIMEOUT: Too slow' }]);
  });

  test('unwraps ok/value envelopes around command results', () => {
    expect(
      extractCommandResults('shell_run', { ok: true, value: { exitCode: 0, stdout: 'hi' } }),
    ).toEqual([{ exitCode: 0, stdout: 'hi' }]);
    expect(
      extractCommandResults('command_run_many', {
        results: [
          { index: 1, ok: true, value: { ok: false, error: 'blocked' } },
          { index: 0, ok: true, value: { ok: true, value: { exitCode: 2, stderr: 'bad' } } },
        ],
      }),
    ).toEqual([{ exitCode: 2, stderr: 'bad' }, { error: 'blocked' }]);
  });

  test('returns null when the output is not a command result', () => {
    expect(extractCommandResults('command_run', { processId: 'p1' })).toBeNull();
    expect(extractCommandResults('file_read', { exitCode: 0 })).toBeNull();
  });
});

describe('tailLines', () => {
  test('keeps short text whole', () => {
    expect(tailLines('a\nb\n', 20)).toEqual({ text: 'a\nb', hidden: 0, total: 2 });
  });

  test('keeps only the last lines of long text', () => {
    const text = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const tail = tailLines(text, 20);
    expect(tail.hidden).toBe(5);
    expect(tail.total).toBe(25);
    expect(tail.text.split('\n')[0]).toBe('line 6');
  });
});
