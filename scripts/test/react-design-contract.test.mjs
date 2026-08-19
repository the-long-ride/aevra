import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const styleFiles = [
  'tokens.css',
  'shell.css',
  'components.css',
  'dashboard.css',
  'admin.css',
  'requests.css',
];

test('React owns the complete web design system', () => {
  const index = readFileSync('apps/web-react/src/styles/index.css', 'utf8');
  for (const file of styleFiles) {
    const path = `apps/web-react/src/styles/${file}`;
    assert.equal(existsSync(path), true, `${path} must exist`);
    assert.match(index, new RegExp(`@import [^;]*${file.replace('.', '\\.')}`));
  }
  assert.doesNotMatch(index, /apps\/web|\.\.\/\.\.\/\.\.\/web/);
});

test('theme tokens implement the approved mono light and dark system', () => {
  const tokens = readFileSync('apps/web-react/src/styles/tokens.css', 'utf8');
  assert.match(tokens, /data-theme=["']light["']/);
  assert.match(tokens, /data-theme=["']dark["']/);
  assert.match(tokens, /#fdfcfc/i);
  assert.match(tokens, /#201d1d/i);
  assert.match(tokens, /JetBrains Mono/);
  assert.match(tokens, /IBM Plex Mono/);
  assert.match(tokens, /border-radius:\s*4px/);
});

test('shell keeps horizontal navigation and theme control styling', () => {
  const shell = readFileSync('apps/web-react/src/styles/shell.css', 'utf8');
  assert.match(shell, /\.top-nav\s*\{/);
  assert.match(shell, /flex-wrap:\s*nowrap/);
  assert.match(shell, /overflow-x:\s*auto/);
  assert.match(shell, /\.theme-toggle/);
});

test('React styles stay flat without shadows or gradients', () => {
  const source = styleFiles
    .map((file) => readFileSync(`apps/web-react/src/styles/${file}`, 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /box-shadow\s*:/i);
  assert.doesNotMatch(source, /(?:linear|radial|conic)-gradient\s*\(/i);
});
