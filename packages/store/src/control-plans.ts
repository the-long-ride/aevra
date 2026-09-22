import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ControlPlanResult } from '../../protocol/src/control.js';

export interface StoredControlPlan {
  planId: string;
  owner: string;
  requestId: string;
  digest: string;
  mode: 'sharedSemantic' | 'isolated';
  status: string;
  cancelled: boolean;
  result?: ControlPlanResult;
  createdAt: string;
  updatedAt: string;
}

function project(row: any): StoredControlPlan {
  return {
    planId: String(row.plan_id),
    owner: String(row.owner),
    requestId: String(row.request_id),
    digest: String(row.digest),
    mode: row.mode === 'isolated' ? 'isolated' : 'sharedSemantic',
    status: String(row.status),
    cancelled: Number(row.cancelled) === 1,
    ...(row.result_json
      ? { result: JSON.parse(String(row.result_json)) as ControlPlanResult }
      : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ControlPlanRepository {
  constructor(private readonly db: DatabaseSync) {}

  digestKey(): Buffer {
    const keyName = 'control.plan.digestKey.v1';
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key=?').get(keyName) as
      { value_json: string } | undefined;
    if (row) {
      const encoded = JSON.parse(row.value_json);
      const key = Buffer.from(String(encoded), 'base64url');
      if (key.length !== 32) throw new Error('Invalid persisted control-plan digest key');
      return key;
    }
    const encoded = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO settings(key,value_json,revision) VALUES(?,?,1)')
      .run(keyName, JSON.stringify(encoded));
    return Buffer.from(encoded, 'base64url');
  }

  claim(input: {
    planId: string;
    owner: string;
    requestId: string;
    digest: string;
    mode: 'sharedSemantic' | 'isolated';
    status: string;
    createdAt: string;
    updatedAt: string;
  }): { record: StoredControlPlan; existing: boolean } {
    return this.transaction(() => this.claimInTransaction(input));
  }

  get(owner: string, planId: string): StoredControlPlan | undefined {
    const row = this.db
      .prepare('SELECT * FROM control_plans WHERE owner=? AND plan_id=?')
      .get(owner, planId) as any | undefined;
    return row ? project(row) : undefined;
  }

  updateStatus(owner: string, planId: string, status: string, cancelled = false): boolean {
    const result = this.db
      .prepare(
        'UPDATE control_plans SET status=?,cancelled=?,updated_at=? WHERE owner=? AND plan_id=?',
      )
      .run(status, cancelled ? 1 : 0, new Date().toISOString(), owner, planId);
    return Number(result.changes) > 0;
  }

  finish(
    owner: string,
    planId: string,
    status: string,
    resultValue: ControlPlanResult,
    cancelled = false,
  ): boolean {
    const result = this.db
      .prepare(
        'UPDATE control_plans SET status=?,cancelled=?,result_json=?,updated_at=? WHERE owner=? AND plan_id=?',
      )
      .run(
        status,
        cancelled ? 1 : 0,
        JSON.stringify(resultValue),
        new Date().toISOString(),
        owner,
        planId,
      );
    return Number(result.changes) > 0;
  }

  recordStep(input: {
    planId: string;
    stepId: string;
    attemptId: string;
    action: string;
    dispatchState: string;
    status: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO control_plan_steps(
          plan_id,step_id,attempt_id,action,dispatch_state,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(plan_id,step_id,attempt_id) DO UPDATE SET
          dispatch_state=excluded.dispatch_state,
          status=excluded.status,
          updated_at=excluded.updated_at`,
      )
      .run(
        input.planId,
        input.stepId,
        input.attemptId,
        input.action,
        input.dispatchState,
        input.status,
        now,
        now,
      );
  }

  reconcileIncomplete(): number {
    const result = this.db
      .prepare(
        `UPDATE control_plans
         SET status='unknown',result_json=NULL,updated_at=?
         WHERE status IN ('running','awaitingApproval')`,
      )
      .run(new Date().toISOString());
    return Number(result?.changes ?? 0);
  }

  private claimInTransaction(input: {
    planId: string;
    owner: string;
    requestId: string;
    digest: string;
    mode: 'sharedSemantic' | 'isolated';
    status: string;
    createdAt: string;
    updatedAt: string;
  }): { record: StoredControlPlan; existing: boolean } {
    const existing = this.db
      .prepare('SELECT * FROM control_plans WHERE owner=? AND request_id=?')
      .get(input.owner, input.requestId) as any | undefined;
    if (existing) return { record: project(existing), existing: true };
    this.db
      .prepare(
        `INSERT INTO control_plans(
          plan_id,owner,request_id,digest,mode,status,cancelled,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,0,?,?)`,
      )
      .run(
        input.planId,
        input.owner,
        input.requestId,
        input.digest,
        input.mode,
        input.status,
        input.createdAt,
        input.updatedAt,
      );
    return { record: this.get(input.owner, input.planId)!, existing: false };
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
