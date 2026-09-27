import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommandRuleV2, validateCommandRuleV2 } from '../src/policy/command-rule-validation.js';

const valid = () => ({
  version: 2,
  application: 'git',
  operation: ['status'],
  allowedModifiers: [],
  allowedOptions: [{ name: '--short' }, { name: '--format', values: ['json'] }],
  positionalConstraint: 'workspace-paths',
  targetScope: 'workspace',
  backends: ['sandbox'],
  dialects: ['direct', 'bash'],
  executableFingerprint: 'sample fingerprint',
  wrapperFingerprints: [],
});

test('a complete typed rule validates and optional script fields are accepted', () => {
  const rule = { ...valid(), scriptName: 'build', scriptFingerprint: 'sample script' };
  assert.deepEqual(validateCommandRuleV2(rule), { ok: true, value: rule });
  assert.equal(isCommandRuleV2(rule), true);
  const exact = { ...valid(), positionalConstraint: 'exact', exactArgv: ['status'] };
  assert.equal(validateCommandRuleV2(exact).ok, true);
});

test('non-object inputs are rejected', () => {
  for (const input of [null, undefined, 'rule', 7, []]) {
    assert.deepEqual(validateCommandRuleV2(input), {
      ok: false,
      message: 'Typed command predicate must be an object',
    });
    assert.equal(isCommandRuleV2(input), false);
  }
});

test('each invalid field yields its specific validation message', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ version: 1 }, 'Typed command predicate version must be 2'],
    [{ application: '' }, 'Typed command predicate requires application'],
    [{ application: 5 }, 'Typed command predicate requires application'],
    [{ operation: 'status' }, 'Typed command predicate operation must be a string array'],
    [{ operation: [1] }, 'Typed command predicate operation must be a string array'],
    [{ allowedModifiers: undefined }, 'allowedModifiers must be a string array'],
    [{ allowedOptions: {} }, 'allowedOptions must be an array'],
    [{ allowedOptions: [null] }, 'allowedOptions entries must be objects'],
    [{ allowedOptions: [['--x']] }, 'allowedOptions entries must be objects'],
    [{ allowedOptions: ['--x'] }, 'allowedOptions entries must be objects'],
    [{ allowedOptions: [{ name: '' }] }, 'allowedOptions entries require a name'],
    [{ allowedOptions: [{ values: [] }] }, 'allowedOptions entries require a name'],
    [
      { allowedOptions: [{ name: '--x', values: 'a' }] },
      'allowedOptions values must be string arrays',
    ],
    [{ positionalConstraint: 'any' }, 'positionalConstraint must be exact or workspace-paths'],
    [{ exactArgv: [1] }, 'exactArgv must be a string array'],
    [{ positionalConstraint: 'exact' }, 'exact positionalConstraint requires exactArgv'],
    [{ targetScope: 'host' }, 'targetScope must be workspace'],
    [{ backends: [] }, 'backends must be a non-empty string array'],
    [{ backends: 'sandbox' }, 'backends must be a non-empty string array'],
    [{ dialects: 'bash' }, 'dialects contains an unsupported dialect'],
    [{ dialects: [] }, 'dialects contains an unsupported dialect'],
    [{ dialects: ['fish'] }, 'dialects contains an unsupported dialect'],
    [{ dialects: [3] }, 'dialects contains an unsupported dialect'],
    [{ executableFingerprint: '' }, 'executableFingerprint must be a non-empty string'],
    [{ executableFingerprint: 9 }, 'executableFingerprint must be a non-empty string'],
    [{ wrapperFingerprints: [false] }, 'wrapperFingerprints must be a string array'],
    [{ scriptName: 4 }, 'scriptName must be a string'],
    [{ scriptFingerprint: {} }, 'scriptFingerprint must be a string'],
  ];
  for (const [patch, message] of cases) {
    assert.deepEqual(
      validateCommandRuleV2({ ...valid(), ...patch }),
      { ok: false, message },
      message,
    );
  }
});
