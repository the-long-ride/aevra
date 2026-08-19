import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('vanilla UI source and compatibility routes are absent', () => {
  assert.equal(existsSync('apps/web'), false);
  const args = readFileSync('apps/cli/src/args.ts', 'utf8');
  const destination = readFileSync('apps/core/src/admin/bootstrap-destination.ts', 'utf8');
  assert.doesNotMatch(args, /--ui-react|\/react\//);
  assert.doesNotMatch(destination, /\/react/);
});

test('React is built at root and owns the canonical design document', () => {
  const vite = readFileSync('apps/web-react/vite.config.ts', 'utf8');
  const design = readFileSync('apps/web-react/design.md', 'utf8');
  assert.match(vite, /base:\s*['"]\/['"]/);
  assert.match(vite, /dist\/apps\/web/);
  assert.doesNotMatch(vite, /dist\/apps\/web\/react/);
  assert.match(design, /no shadows/i);
  assert.match(design, /horizontal/i);
  assert.match(design, /light/i);
  assert.match(design, /dark/i);
  assert.match(design, /must not bundle or redistribute Berkeley Mono/i);
});

test('React shell exposes theme immediately before Requests', () => {
  const shell = readFileSync('apps/web-react/src/components/AppShell.tsx', 'utf8');
  const themeIndex = shell.indexOf('className="theme-toggle"');
  const requestsIndex = shell.indexOf('id="open-requests"');
  assert.ok(themeIndex >= 0);
  assert.ok(requestsIndex > themeIndex);
});
