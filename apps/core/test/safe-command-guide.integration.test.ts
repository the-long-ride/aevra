import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminServer } from '../src/admin/server.js';

const bootstrap = { validateSession: (value: string | undefined) => value === 'keep-me' } as any;

test('guide API exposes the safe command matcher chapter', async () => {
  const server = new AdminServer('127.0.0.1', 0, () => ({ core: 'running' }), {
    bootstrap,
    api: {} as any,
  });
  await server.start();
  try {
    const response = await fetch(`${server.url()}/api/guide`, {
      headers: { cookie: 'aevra_admin=keep-me' },
    });
    assert.equal(response.status, 200);
    const chapters = (await response.json()) as any[];
    assert.ok(
      chapters.some(
        (chapter) =>
          chapter.slug === 'safe-command-matchers' &&
          chapter.file === '16-safe-command-matchers.md',
      ),
    );
  } finally {
    await server.close();
  }
});
