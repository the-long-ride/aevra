import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { DesktopAccessRepository } from '../src/desktop-access.js';

test('pending desktop requests hydrate identities with one SELECT for the list', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();
  const prepared: string[] = [];
  const observed = new Proxy(raw, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          prepared.push(sql);
          return target.prepare(sql);
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const repository = new DesktopAccessRepository(observed);
  const now = new Date().toISOString();
  try {
    for (let index = 0; index < 3; index += 1) {
      repository.createOrGetPending({
        id: `request-${index}`,
        actor: 'oauth:ChatGPT',
        sessionId: `session-${index}`,
        workspaceId: null,
        scope: 'host',
        requesterIdentity: { kind: 'oauth', key: 'connection-1' },
        windowId: `window-${index}`,
        targetExecutablePath: 'C:\\Apps\\private.exe',
        targetProcessId: 10 + index,
        targetProcessStartedAt: now,
        hostExecutablePath: 'C:\\Apps\\private.exe',
        hostWindowId: `window-${index}`,
        hostProcessId: 10 + index,
        hostProcessStartedAt: now,
        requestedDuration: 'session',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      });
    }
    prepared.length = 0;
    const pending = repository.listPending(now);
    assert.equal(pending.length, 3);
    assert.deepEqual(
      pending.map((request) => request.requesterIdentity),
      [
        { kind: 'oauth', key: 'connection-1' },
        { kind: 'oauth', key: 'connection-1' },
        { kind: 'oauth', key: 'connection-1' },
      ],
    );
    assert.equal(
      prepared.filter((sql) => /SELECT[\s\S]*FROM desktop_access_requests/i.test(sql)).length,
      1,
    );
  } finally {
    db.close();
  }
});
