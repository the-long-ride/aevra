import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ControlPlan, ControlPlanResult } from '../../protocol/src/control.js';

export interface ControlPlanJournalRecord {
  planId: string;
  owner: string;
  requestId: string;
  digest: string;
  status:
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'awaitingApproval'
    | 'needsContext'
    | 'unknown';
  cancelled: boolean;
  result?: ControlPlanResult;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlanPersistence {
  claim(input: {
    planId: string;
    owner: string;
    requestId: string;
    digest: string;
    mode: 'sharedSemantic' | 'isolated';
    status: string;
    createdAt: string;
    updatedAt: string;
  }): {
    record: {
      planId: string;
      owner: string;
      requestId: string;
      digest: string;
      status: string;
      cancelled: boolean;
      createdAt: string;
      updatedAt: string;
      result?: ControlPlanResult;
    };
    existing: boolean;
  };
  get(
    owner: string,
    planId: string,
  ):
    | {
        planId: string;
        owner: string;
        requestId: string;
        digest: string;
        status: string;
        cancelled: boolean;
        createdAt: string;
        updatedAt: string;
        result?: ControlPlanResult;
      }
    | undefined;
  digestKey(): Buffer;
  updateStatus(owner: string, planId: string, status: string, cancelled?: boolean): boolean;
  finish(
    owner: string,
    planId: string,
    status: string,
    result: ControlPlanResult,
    cancelled?: boolean,
  ): boolean;
  recordStep(input: {
    planId: string;
    stepId: string;
    attemptId: string;
    action: string;
    dispatchState: string;
    status: string;
  }): void;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function status(value: string): ControlPlanJournalRecord['status'] {
  switch (value) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'awaitingApproval':
    case 'needsContext':
    case 'unknown':
      return value;
    default:
      return 'running';
  }
}

function durableResult(result: ControlPlanResult): ControlPlanResult {
  return {
    planId: result.planId,
    status: result.status,
    steps: result.steps.map((step) => ({ ...step })),
  };
}

export class ControlPlanJournal {
  private readonly key: Buffer;
  private readonly records = new Map<string, ControlPlanJournalRecord>();
  private readonly byRequest = new Map<string, string>();

  constructor(private readonly persistence?: ControlPlanPersistence) {
    this.key = persistence?.digestKey() ?? randomBytes(32);
  }

  claim(owner: string, plan: ControlPlan): { record: ControlPlanJournalRecord; existing: boolean } {
    const digest = createHmac('sha256', this.key).update(canonical(plan)).digest('hex');
    const requestKey = `${owner}\0${plan.requestId}`;
    const existingId = this.byRequest.get(requestKey);
    if (existingId) {
      const existing = this.records.get(existingId)!;
      if (existing.digest !== digest) this.conflict();
      return { record: structuredClone(existing), existing: true };
    }

    const now = new Date().toISOString();
    const proposed: ControlPlanJournalRecord = {
      planId: `plan_${randomUUID()}`,
      owner,
      requestId: plan.requestId,
      digest,
      status: 'running',
      cancelled: false,
      createdAt: now,
      updatedAt: now,
    };
    const durable = this.persistence?.claim({
      planId: proposed.planId,
      owner,
      requestId: plan.requestId,
      digest,
      mode: plan.mode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    });
    if (durable?.existing) {
      if (durable.record.digest !== digest) this.conflict();
      const record: ControlPlanJournalRecord = {
        ...proposed,
        planId: durable.record.planId,
        status: status(durable.record.status),
        cancelled: durable.record.cancelled,
        createdAt: durable.record.createdAt,
        updatedAt: durable.record.updatedAt,
        ...(durable.record.result ? { result: structuredClone(durable.record.result) } : {}),
      };
      this.records.set(record.planId, record);
      this.byRequest.set(requestKey, record.planId);
      return { record: structuredClone(record), existing: true };
    }

    this.records.set(proposed.planId, proposed);
    this.byRequest.set(requestKey, proposed.planId);
    return { record: structuredClone(proposed), existing: false };
  }

  get(owner: string, planId: string): ControlPlanJournalRecord | undefined {
    const memory = this.records.get(planId);
    if (memory?.owner === owner) return structuredClone(memory);
    const durable = this.persistence?.get(owner, planId);
    if (!durable) return undefined;
    const projected: ControlPlanJournalRecord = {
      planId: durable.planId,
      owner: durable.owner,
      requestId: durable.requestId,
      digest: durable.digest,
      status: status(durable.status),
      cancelled: durable.cancelled,
      createdAt: durable.createdAt,
      updatedAt: durable.updatedAt,
      ...(durable.result ? { result: structuredClone(durable.result) } : {}),
    };
    return projected;
  }

  isCancelled(owner: string, planId: string): boolean {
    return this.get(owner, planId)?.cancelled === true;
  }

  cancel(owner: string, planId: string): boolean {
    const record = this.records.get(planId);
    if (record?.owner === owner) {
      record.cancelled = true;
      record.status = 'cancelled';
      record.updatedAt = new Date().toISOString();
      this.persistence?.updateStatus(owner, planId, 'cancelled', true);
      return true;
    }
    if (!this.persistence?.get(owner, planId)) return false;
    return this.persistence.updateStatus(owner, planId, 'cancelled', true);
  }

  recordStep(
    owner: string,
    planId: string,
    stepId: string,
    action: string,
    dispatchState: string,
    stepStatus: string,
  ): void {
    if (!this.get(owner, planId)) return;
    this.persistence?.recordStep({
      planId,
      stepId,
      attemptId: `${planId}:${stepId}:1`,
      action,
      dispatchState,
      status: stepStatus,
    });
  }

  finish(owner: string, result: ControlPlanResult): void {
    const record = this.records.get(result.planId);
    const nextStatus: ControlPlanJournalRecord['status'] =
      result.status === 'partial'
        ? 'failed'
        : result.status === 'awaitingApproval'
          ? 'awaitingApproval'
          : result.status;
    if (record?.owner === owner) {
      record.result = structuredClone(result);
      record.status = nextStatus;
      record.updatedAt = new Date().toISOString();
    }
    this.persistence?.finish(
      owner,
      result.planId,
      nextStatus,
      durableResult(result),
      nextStatus === 'cancelled',
    );
  }

  private conflict(): never {
    throw Object.assign(
      new Error('CONTROL_REQUEST_CONFLICT: requestId was reused with different plan content'),
      { code: 'CONTROL_REQUEST_CONFLICT' },
    );
  }
}
