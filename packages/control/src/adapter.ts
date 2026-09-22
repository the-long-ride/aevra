import type {
  ControlAction,
  ControlCapabilities,
  ControlMode,
  ControlObservation,
  ControlTarget,
} from '../../protocol/src/control.js';

export interface ControlDispatchReceipt {
  dispatched: boolean;
  outcome: 'completed' | 'alreadySatisfied';
  detail?: string;
}

export interface ControlAdapter {
  readonly surfaceId: string;
  readonly mode: ControlMode;
  capabilities(): ControlCapabilities;
  observe(): Promise<ControlObservation>;
  dispatch(
    target: ControlTarget,
    action: ControlAction,
    timeoutMs: number,
  ): Promise<ControlDispatchReceipt>;
  close?(): Promise<void> | void;
}

export class ControlAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly dispatchState: 'notDispatched' | 'dispatched' | 'unknown' = 'notDispatched',
    readonly recovery:
      | 'refresh'
      | 'needsContext'
      | 'needsApproval'
      | 'chooseIsolatedRunner'
      | 'inspectOutcome'
      | 'none' = 'none',
  ) {
    super(`${code}: ${message}`);
    this.name = 'ControlAdapterError';
  }
}
