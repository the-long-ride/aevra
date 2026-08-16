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

test('Guide isolates chapter and article scrolling with sticky desktop and mobile navigation', () => {
  const admin = readFileSync('apps/web-react/src/styles/admin.css', 'utf8');
  assert.match(admin, /\.guide-sidebar\s*\{[^}]*position:\s*sticky[^}]*\}/s);
  assert.match(admin, /\.guide-search\s*\{[^}]*position:\s*sticky[^}]*\}/s);
  assert.match(admin, /\.guide-chapter-scroll\s*\{[^}]*overflow-y:\s*auto[^}]*\}/s);
  assert.match(admin, /\.manual-content\s*\{[^}]*overflow:\s*hidden[^}]*\}/s);
  assert.match(admin, /\.manual-scroll\s*\{[^}]*overflow-y:\s*auto[^}]*\}/s);
  assert.match(admin, /\.guide-mobile-picker\s*\{[^}]*position:\s*sticky[^}]*\}/s);
  assert.match(admin, /scrollbar-width:\s*thin/);
});

test('React styles stay flat with one narrowly scoped YOLO gradient exception', () => {
  const source = styleFiles
    .map((file) => readFileSync(`apps/web-react/src/styles/${file}`, 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /box-shadow\s*:/i);
  const gradientLines = source
    .split('\n')
    .filter((line) => /(?:linear|radial|conic)-gradient\s*\(/i.test(line));
  assert.equal(gradientLines.length, 1);
  assert.match(gradientLines[0], /--yolo-gradient:/);
  assert.match(source, /\.yolo-action/);
  assert.match(source, /@keyframes\s+yolo-gradient-shift/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test('browser title is exactly Aevra', () => {
  const index = readFileSync('apps/web-react/index.html', 'utf8');
  assert.match(index, /<title>Aevra<\/title>/);
  assert.doesNotMatch(index, /<title>[^<]*React[^<]*<\/title>/i);
});

test('web shell uses the canonical repo logo and favicon assets', () => {
  const index = readFileSync('apps/web-react/index.html', 'utf8');
  const shell = readFileSync('apps/web-react/src/components/AppShell.tsx', 'utf8');
  const vite = readFileSync('apps/web-react/vite.config.ts', 'utf8');

  assert.equal(existsSync('assets/aevra-logo.png'), true);
  for (const file of [
    'favicon/favicon.ico',
    'favicon/favicon-16x16.png',
    'favicon/favicon-32x32.png',
    'favicon/apple-touch-icon.png',
    'favicon/android-chrome-192x192.png',
    'favicon/android-chrome-512x512.png',
  ]) {
    assert.equal(existsSync(`assets/${file}`), true, `assets/${file} must exist`);
  }

  assert.match(vite, /publicDir:\s*['"]\.\.\/\.\.\/assets['"]/);
  assert.match(shell, /src=["']\/aevra-logo\.png["']/);
  assert.match(index, /href=["']\/favicon\/favicon\.ico["']/);
  assert.match(index, /href=["']\/favicon\/favicon-16x16\.png["']/);
  assert.match(index, /href=["']\/favicon\/favicon-32x32\.png["']/);
  assert.match(index, /href=["']\/favicon\/apple-touch-icon\.png["']/);
});
