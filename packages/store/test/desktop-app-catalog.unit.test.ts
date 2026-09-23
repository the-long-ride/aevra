import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { DesktopAppCatalogRepository } from '../src/desktop-app-catalog.js';

test('saveCustom assigns an ID when the caller omits one', () => {
  const db = AevraDatabase.open(':memory:');
  try {
    const repository = new DesktopAppCatalogRepository(db.raw());
    const pathKey = 'c:\\apps\\sample.exe';
    const saved = repository.saveCustom({
      pathKey,
      executablePath: 'C:\\Apps\\Sample.exe',
      displayName: 'Sample',
      version: null,
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
    });

    assert.match(saved.id, /^[0-9a-f-]{36}$/i);
    assert.equal(saved.displayName, 'Sample');
    assert.equal(repository.listCustom().length, 1);
  } finally {
    db.close();
  }
});
