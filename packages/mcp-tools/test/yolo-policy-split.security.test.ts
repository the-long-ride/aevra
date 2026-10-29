import assert from 'node:assert/strict';
import test from 'node:test';
import {
  criticalConfirmRequired,
  readYoloPolicy,
  yoloAllows,
  yoloDoesWhatever,
} from '../src/yolo-mode.js';

function context(options: { yolo: boolean; policy?: unknown; alwaysConfirm?: boolean }): any {
  return {
    sessions: { isYolo: () => options.yolo },
    deps: {
      settings: {
        get: (key: string, fallback: any) => {
          if (key === 'policy.yolo') return options.policy ?? fallback;
          if (key === 'policy.critical.alwaysConfirm') return options.alwaysConfirm ?? false;
          return fallback;
        },
      },
    },
  };
}

const op = (risk: 'HIGH' | 'CRITICAL') => ({
  capability: 'commands.run' as const,
  risk,
  family: 'x',
});

test('readYoloPolicy normalizes stored value', () => {
  assert.deepEqual(readYoloPolicy(context({ yolo: true, policy: { mode: 'unrestricted' } })), {
    mode: 'unrestricted',
    risk: 'prevent-high-risk',
  });
  assert.deepEqual(readYoloPolicy(context({ yolo: true })), {
    mode: 'workspace',
    risk: 'prevent-high-risk',
  });
});

test('do-whatever: critical confirmation off even with alwaysConfirm', () => {
  const ctx = context({
    yolo: true,
    policy: { mode: 'workspace', risk: 'do-whatever' },
    alwaysConfirm: true,
  });
  assert.equal(yoloDoesWhatever(ctx, 's1'), true);
  assert.equal(criticalConfirmRequired(ctx, 'CRITICAL', 's1'), false);
  assert.equal(yoloAllows(ctx, 's1', op('CRITICAL')), true);
  assert.equal(yoloAllows(ctx, 's1', op('HIGH')), true);
});

test('do-whatever does nothing for non-YOLO sessions', () => {
  const ctx = context({
    yolo: false,
    policy: { mode: 'unrestricted', risk: 'do-whatever' },
    alwaysConfirm: true,
  });
  assert.equal(yoloDoesWhatever(ctx, 's1'), false);
  assert.equal(criticalConfirmRequired(ctx, 'CRITICAL', 's1'), true);
  assert.equal(yoloAllows(ctx, 's1', op('HIGH')), false);
});

test('prevent-high-risk: unrestricted scope still confirms CRITICAL', () => {
  const ctx = context({ yolo: true, policy: { mode: 'unrestricted' } });
  assert.equal(yoloDoesWhatever(ctx, 's1'), false);
  assert.equal(criticalConfirmRequired(ctx, 'CRITICAL', 's1'), true);
  assert.equal(yoloAllows(ctx, 's1', op('CRITICAL')), false);
  assert.equal(yoloAllows(ctx, 's1', op('HIGH')), true);
});
