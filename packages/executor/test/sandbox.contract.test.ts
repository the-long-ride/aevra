import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveEnvironmentProfile, managedCacheRoot } from '../src/sandbox.js';

test('environment resolution and caches stay Aevra-owned', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-'));
  assert.equal(resolveEnvironmentProfile(d).source, 'generic');

  const override = resolveEnvironmentProfile(d, { image: 'custom:latest' });
  assert.equal(override.source, 'workspace');
  assert.equal(override.image, 'custom:latest');

  const devDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-dev-'));
  mkdirSync(path.join(devDir, '.devcontainer'), { recursive: true });
  writeFileSync(path.join(devDir, '.devcontainer', 'devcontainer.json'), '{}');
  assert.equal(resolveEnvironmentProfile(devDir).source, 'devcontainer');

  const dockerDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-df-'));
  writeFileSync(path.join(dockerDir, 'Dockerfile'), 'FROM alpine');
  assert.equal(resolveEnvironmentProfile(dockerDir).source, 'dockerfile');

  const rustDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-rs-'));
  writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]');
  const rustProf = resolveEnvironmentProfile(rustDir);
  assert.equal(rustProf.source, 'detected');
  assert.equal(rustProf.image, 'rust:1-bookworm');

  const goDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-go-'));
  writeFileSync(path.join(goDir, 'go.mod'), 'module app');
  const goProf = resolveEnvironmentProfile(goDir);
  assert.equal(goProf.source, 'detected');
  assert.equal(goProf.image, 'golang:1-bookworm');

  const pyDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-py-'));
  writeFileSync(path.join(pyDir, 'pyproject.toml'), '[project]');
  const pyProf = resolveEnvironmentProfile(pyDir);
  assert.equal(pyProf.source, 'detected');
  assert.equal(pyProf.image, 'python:3.12-slim');

  const nodeDir = mkdtempSync(path.join(os.tmpdir(), 'aevra-sbx-node-'));
  writeFileSync(path.join(nodeDir, 'package.json'), '{}');
  const nodeProf = resolveEnvironmentProfile(nodeDir);
  assert.equal(nodeProf.source, 'detected');
  assert.equal(nodeProf.image, 'node:22-bookworm-slim');

  const c = managedCacheRoot(d, 'npm', 'workspace', 'w')!;
  assert.equal(c.startsWith(path.join(d, 'sandbox-cache')), true);
  const shared = managedCacheRoot(d, 'pip', 'shared', 'w')!;
  assert.equal(shared.endsWith('shared'), true);
  assert.equal(managedCacheRoot(d, 'npm', 'disabled', 'w'), null);
});
