import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperationRisk } from '../src/policy/risk.js';

test('filesystem destruction classifies CRITICAL', () => {
  assert.equal(classifyOperationRisk('rm:run', ['-rf', '/']), 'CRITICAL');
  assert.equal(classifyOperationRisk('rm:run', ['-rf', '~']), 'CRITICAL');
  assert.equal(classifyOperationRisk('mkfs.ext4:run', ['/dev/sda1']), 'CRITICAL');
  assert.equal(classifyOperationRisk('dd:run', ['if=/dev/zero', 'of=/dev/sda']), 'CRITICAL');
  assert.equal(classifyOperationRisk('shutdown:run', ['-h', 'now']), 'CRITICAL');
});

test('scoped recursive deletion classifies HIGH', () => {
  assert.equal(classifyOperationRisk('rm:run', ['-rf', './build']), 'HIGH');
  assert.equal(classifyOperationRisk('chmod:run', ['-R', '777', './src']), 'HIGH');
  assert.equal(classifyOperationRisk('npm:publish', []), 'HIGH');
});

test('existing classifications are unchanged', () => {
  assert.equal(classifyOperationRisk('sudo:run', []), 'CRITICAL');
  assert.equal(classifyOperationRisk('git:push', ['--force']), 'HIGH');
  assert.equal(classifyOperationRisk('git:push', []), 'MEDIUM');
  assert.equal(classifyOperationRisk('git:commit', []), 'MEDIUM');
  assert.equal(classifyOperationRisk('package:install', []), 'MEDIUM');
  assert.equal(classifyOperationRisk('npm:test', []), 'LOW');
  assert.equal(classifyOperationRisk('git:status', []), 'LOW');
});
