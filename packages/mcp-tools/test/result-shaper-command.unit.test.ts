import assert from 'node:assert/strict';
import test from 'node:test';
import { outputBudget, unwrapOk } from '../src/result-shaper/common.js';
import {
  budgetOutput,
  looksLikeCommandResult,
  shapeCommandValue,
  tidyOutput,
} from '../src/result-shaper/command-output.js';

test('tidyOutput normalises CRLF', () => {
  assert.equal(tidyOutput('a\r\nb\r\n'), 'a\nb\n');
});

test('tidyOutput keeps only the final state of a redrawn progress line', () => {
  assert.equal(tidyOutput('p 10%\rp 50%\rp 100%\ndone'), 'p 100%\ndone');
});

test('tidyOutput collapses three or more identical lines', () => {
  assert.equal(tidyOutput('x\nx\nx\nx\ny'), 'x\n… (repeated 4×)\ny');
  assert.equal(tidyOutput('x\nx\ny'), 'x\nx\ny');
});

test('tidyOutput never collapses blank lines', () => {
  assert.equal(tidyOutput('a\n\n\n\n\nb'), 'a\n\n\n\n\nb');
});

test('budgetOutput leaves short text and cuts long text 25/75', () => {
  assert.deepEqual(budgetOutput('short', 256), { text: 'short', truncated: false });
  const long = 'h'.repeat(400) + 'm'.repeat(1000) + 't'.repeat(1000);
  const cut = budgetOutput(long, 1000);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.startsWith('h'.repeat(250)));
  assert.ok(cut.text.endsWith('t'.repeat(750)));
  assert.match(cut.text, /\n… \[1400 chars omitted\] …\n/);
});

test('outputBudget defaults and clamps', () => {
  assert.equal(outputBudget({}), 16000);
  assert.equal(outputBudget(undefined), 16000);
  assert.equal(outputBudget({ maxOutputChars: 10 }), 256);
  assert.equal(outputBudget({ maxOutputChars: 9_999_999 }), 200000);
  assert.equal(outputBudget({ maxOutputChars: 'x' }), 16000);
  assert.equal(outputBudget({ maxOutputChars: 4000.7 }), 4000);
});

test('unwrapOk only unwraps a bare {ok:true,value:object}', () => {
  assert.deepEqual(unwrapOk({ ok: true, value: { a: 1 } }), { a: 1 });
  const extra = { ok: true, value: { a: 1 }, note: 'x' };
  assert.equal(unwrapOk(extra), extra);
  const failed = { ok: false, error: 'no' };
  assert.equal(unwrapOk(failed), failed);
  assert.equal(unwrapOk('text'), 'text');
});

test('looksLikeCommandResult needs exitCode and string stdout', () => {
  assert.equal(looksLikeCommandResult({ exitCode: 0, stdout: '' }), true);
  assert.equal(looksLikeCommandResult({ exitCode: 0 }), false);
  assert.equal(looksLikeCommandResult(null), false);
});

test('shapeCommandValue drops empty noise, tidies and budgets both streams', () => {
  const shaped = shapeCommandValue(
    { exitCode: 1, signal: null, stdout: 'a\r\nb', stderr: '', durationMs: 12 },
    256,
  );
  assert.deepEqual(shaped, { exitCode: 1, stdout: 'a\nb', durationMs: 12 });
  const big = shapeCommandValue(
    { exitCode: 0, signal: null, stdout: 'z'.repeat(5000), stderr: 'e' },
    1000,
  );
  assert.equal(big.truncated, true);
  assert.ok((big.stdout as string).length < 1100);
  assert.equal(big.stderr, 'e');
  assert.equal(
    shapeCommandValue({ exitCode: 0, signal: 'SIGTERM', stdout: '' }, 256).signal,
    'SIGTERM',
  );
});
