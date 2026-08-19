import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ChangeSet,
  MutationRecordInput,
  RollbackOptions,
  RollbackResult,
} from '../../../../packages/protocol/src/index.js';
import type { ChangeRepository } from '../../../../packages/store/src/changes.js';
import type { OperationRepository } from '../../../../packages/store/src/operations.js';
import type { WorkspaceService } from '../workspaces/workspace-service.js';
import type { WorkerGateway } from '../../../../packages/mcp-tools/src/service.js';
export type OperationState =
  'PREPARING' | 'AUTHORIZED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
export class ChangeSetService {
  private active = new Map<string, string>();
  constructor(
    private changes: ChangeRepository,
    private operations: OperationRepository,
    private workspaces: WorkspaceService,
    private worker: WorkerGateway,
    private recoveryDir: string,
    private maxSingleSnapshot = 20 * 1024 * 1024,
  ) {}
  async begin(sessionId: string, workspaceId: string, name?: string): Promise<ChangeSet> {
    const c: ChangeSet = {
      id: `chg_${randomUUID()}`,
      workspaceId,
      ownerSessionId: sessionId,
      state: 'OPEN',
    };
    this.changes.put({ ...c, name });
    this.active.set(`${sessionId}\0${workspaceId}`, c.id);
    await mkdir(path.join(this.recoveryDir, workspaceId, c.id, 'snapshots'), { recursive: true });
    await this.writeManifest(c.id, workspaceId, {
      id: c.id,
      workspaceId,
      ownerSessionId: sessionId,
      state: 'OPEN',
      operations: [],
    });
    return c;
  }
  async activeOrBegin(sessionId: string, workspaceId: string) {
    const key = `${sessionId}\0${workspaceId}`,
      id = this.active.get(key);
    if (id) return { id, workspaceId, ownerSessionId: sessionId, state: 'OPEN' } as ChangeSet;
    return this.begin(sessionId, workspaceId);
  }
  async snapshot(sessionId: string, workspaceId: string, logicalPath: string, operationId: string) {
    const c = await this.activeOrBegin(sessionId, workspaceId);
    const destination = path.join(
      this.recoveryDir,
      workspaceId,
      c.id,
      'snapshots',
      `${operationId}.before`,
    );
    const r = await this.worker.execute({
      sessionId,
      workspaceId,
      roots: this.workspaces.capabilityRoots(workspaceId),
      operation: { kind: 'recovery.snapshot', path: logicalPath, destination },
    });
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    const v = r.value as any;
    if (v.sizeBytes > this.maxSingleSnapshot)
      throw Object.assign(new Error('Snapshot exceeds configured maximum'), {
        code: 'RECOVERY_REQUIRED',
      });
    return { changeSet: c, snapshotPath: destination, sizeBytes: v.sizeBytes };
  }
  async recordMutation(
    input: MutationRecordInput & { metadata?: Record<string, unknown> },
  ): Promise<void> {
    this.changes.record(input);
  }
  list() {
    const db = (this.changes as any).db;
    return db ? db.prepare('SELECT * FROM change_sets ORDER BY updated_at DESC').all() : [];
  }
  status(changeSetId: string, sessionId?: string) {
    const db = (this.changes as any).db;
    if (!db) return null;
    const row = db.prepare('SELECT * FROM change_sets WHERE id=?').get(changeSetId) as any;
    if (!row || (sessionId && row.owner_session_id !== sessionId)) return null;
    return row;
  }
  rename(changeSetId: string, name: string) {
    const db = (this.changes as any).db;
    if (!db) return null;
    db.prepare('UPDATE change_sets SET name=?,updated_at=? WHERE id=?').run(
      name,
      new Date().toISOString(),
      changeSetId,
    );
    return this.status(changeSetId);
  }
  async commit(changeSetId: string) {
    const db = (this.changes as any).db;
    if (db)
      db.prepare("UPDATE change_sets SET state='COMMITTED',updated_at=? WHERE id=?").run(
        new Date().toISOString(),
        changeSetId,
      );
  }
  async rollback(changeSetId: string, options: RollbackOptions): Promise<RollbackResult> {
    const db = (this.changes as any).db;
    if (!db) return { kind: 'conflict', paths: ['repository unavailable'] };
    const c = db.prepare('SELECT * FROM change_sets WHERE id=?').get(changeSetId);
    if (!c) throw new Error('change set not found');
    const rows = db
      .prepare('SELECT * FROM change_operations WHERE change_set_id=? ORDER BY id DESC')
      .all(changeSetId) as any[];
    const conflicts: string[] = [];
    for (const r of rows) {
      if (options.skipPaths.includes(r.logical_path)) continue;
      const metadata = JSON.parse(r.metadata_json ?? '{}');
      if (metadata.kind === 'create') {
        const read = await this.worker.execute({
          sessionId: c.owner_session_id,
          workspaceId: c.workspace_id,
          roots: this.workspaces.capabilityRoots(c.workspace_id),
          operation: { kind: 'file.read', path: r.logical_path },
        });
        if (
          read.ok &&
          r.after_hash &&
          (read.value as any).hash !== r.after_hash &&
          !options.force
        ) {
          conflicts.push(r.logical_path);
          continue;
        }
        await this.worker.execute({
          sessionId: c.owner_session_id,
          workspaceId: c.workspace_id,
          roots: this.workspaces.capabilityRoots(c.workspace_id),
          operation: { kind: 'file.delete', path: r.logical_path, recursive: false },
        });
        continue;
      }
      if (metadata.kind === 'move' && metadata.to) {
        await this.worker.execute({
          sessionId: c.owner_session_id,
          workspaceId: c.workspace_id,
          roots: this.workspaces.capabilityRoots(c.workspace_id),
          operation: { kind: 'file.delete', path: metadata.to, recursive: false },
        });
      }
      if (!r.snapshot_path) continue;
      const read = await this.worker.execute({
        sessionId: c.owner_session_id,
        workspaceId: c.workspace_id,
        roots: this.workspaces.capabilityRoots(c.workspace_id),
        operation: { kind: 'file.read', path: r.logical_path },
      });
      if (read.ok && r.after_hash && (read.value as any).hash !== r.after_hash && !options.force) {
        conflicts.push(r.logical_path);
        continue;
      }
      await this.worker.execute({
        sessionId: c.owner_session_id,
        workspaceId: c.workspace_id,
        roots: this.workspaces.capabilityRoots(c.workspace_id),
        operation: { kind: 'recovery.restore', snapshot: r.snapshot_path, path: r.logical_path },
      });
    }
    if (conflicts.length) return { kind: 'conflict', paths: conflicts };
    db.prepare("UPDATE change_sets SET state='ROLLED_BACK',updated_at=? WHERE id=?").run(
      new Date().toISOString(),
      changeSetId,
    );
    return { kind: 'rolled-back' };
  }
  async reconcileIncompleteOperations() {
    for (const row of this.operations.incomplete())
      this.operations.updateState(row.id, 'INTERRUPTED', {
        reason: 'daemon restart; mutation not replayed',
      });
  }
  private async writeManifest(id: string, workspaceId: string, value: unknown) {
    const dir = path.join(this.recoveryDir, workspaceId, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(value, null, 2));
    await writeFile(path.join(dir, 'forward.patch'), '');
    await writeFile(path.join(dir, 'reverse.patch'), '');
  }
}
