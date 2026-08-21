import assert from 'node:assert/strict';
import test from 'node:test';
import { main } from '../src/cli.js';

test('CLI start without admin credentials exits with a friendly message', async () => {
  const previousUser = process.env.AEVRA_USERNAME;
  const previousPass = process.env.AEVRA_PASSWORD;
  delete process.env.AEVRA_USERNAME;
  delete process.env.AEVRA_PASSWORD;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const code = await main(['start']);
    assert.equal(code, 1);
    const text = errors.join('\n');
    assert.match(text, /ADMIN_CREDENTIALS_REQUIRED/);
    assert.match(text, /Set both AEVRA_USERNAME and AEVRA_PASSWORD/);
    assert.doesNotMatch(text, /at loadAdminCredentials/);
  } finally {
    console.error = original;
    if (previousUser === undefined) delete process.env.AEVRA_USERNAME;
    else process.env.AEVRA_USERNAME = previousUser;
    if (previousPass === undefined) delete process.env.AEVRA_PASSWORD;
    else process.env.AEVRA_PASSWORD = previousPass;
  }
});

test('CLI completion does not require admin credentials', async () => {
  const previousUser = process.env.AEVRA_USERNAME;
  const previousPass = process.env.AEVRA_PASSWORD;
  delete process.env.AEVRA_USERNAME;
  delete process.env.AEVRA_PASSWORD;
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(['completion', 'bash']);
    assert.equal(code, 0);
    assert.match(chunks.join(''), /complete -F _aevra aevra/);
  } finally {
    process.stdout.write = original;
    if (previousUser === undefined) delete process.env.AEVRA_USERNAME;
    else process.env.AEVRA_USERNAME = previousUser;
    if (previousPass === undefined) delete process.env.AEVRA_PASSWORD;
    else process.env.AEVRA_PASSWORD = previousPass;
  }
});
