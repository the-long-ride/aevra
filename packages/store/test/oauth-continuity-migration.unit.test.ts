import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AevraDatabase } from '../src/database.js';
import { applyMigrations } from '../src/migrations.js';
import { ApprovalRepository } from '../src/approvals.js';
import { OAuthConnectionOriginsRepository } from '../src/oauth-connection-origins.js';

test('migration 014 adds connection_subject and oauth_connection_origins idempotently', () => {
  const db = AevraDatabase.open(':memory:');
  const raw = db.raw();

  // Test pending_approvals has connection_subject
  const approvalRepo = new ApprovalRepository(raw);
  const now = '2026-09-17T12:00:00.000Z';
  approvalRepo.put({
    id: 'req_mig_1',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    connectionSubject: 'conn_mig_subject',
    workspaceId: 'ws_1',
    operation: { kind: 'file:read' },
    risk: 'LOW',
    state: 'PENDING',
    expiresAt: now,
  });

  const row = raw
    .prepare('SELECT connection_subject FROM pending_approvals WHERE id=?')
    .get('req_mig_1') as any;
  assert.equal(row.connection_subject, 'conn_mig_subject');

  // Test re-running migrations is idempotent
  applyMigrations(raw);
  const rowAfter = raw
    .prepare('SELECT connection_subject FROM pending_approvals WHERE id=?')
    .get('req_mig_1') as any;
  assert.equal(rowAfter.connection_subject, 'conn_mig_subject');

  db.close();
});

test('oauth connection origins records, prunes after 24h, and limits to 10 origins per subject', () => {
  const db = AevraDatabase.open(':memory:');
  const originsRepo = new OAuthConnectionOriginsRepository(db.raw());
  const subject = 'sub_origins_test';
  const baseTime = Date.parse('2026-09-17T12:00:00.000Z');

  // Record 12 IPs at successive minutes
  for (let i = 1; i <= 12; i++) {
    const timeIso = new Date(baseTime + i * 60_000).toISOString();
    originsRepo.record(subject, `198.51.100.${i}`, timeIso);
  }

  const list = originsRepo.list(subject, new Date(baseTime + 13 * 60_000).toISOString());
  // Should retain only the latest 10
  assert.equal(list.length, 10);
  assert.equal(list[0]?.remoteIp, '198.51.100.12');
  assert.equal(list[9]?.remoteIp, '198.51.100.3');

  // Pruning: record an IP older than 24 hours
  const oldTimeIso = new Date(baseTime - 25 * 60 * 60 * 1000).toISOString();
  originsRepo.record(subject, '10.0.0.1', oldTimeIso);

  const afterOld = originsRepo.list(subject, new Date(baseTime + 13 * 60_000).toISOString());
  assert.equal(
    afterOld.some((item) => item.remoteIp === '10.0.0.1'),
    false,
  );

  db.close();
});
