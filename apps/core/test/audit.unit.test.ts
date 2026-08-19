import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { AuditRepository } from '../../../packages/store/src/audit.js';
import { AuditService } from '../src/audit/audit-service.js';
test('audit chain verifies', () => {
  const db = AevraDatabase.open(':memory:');
  const a = new AuditService(new AuditRepository(db.raw()));
  a.append({ operation: 'read', result: 'ok', redactionCount: 0 });
  a.append({ operation: 'write', result: 'ok', redactionCount: 0 });
  assert.deepEqual(a.verify(), { valid: true });
  db.close();
});
