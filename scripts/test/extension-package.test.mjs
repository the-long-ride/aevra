import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTENSION_ROOT,
  extensionEntries,
  normalizeVersion,
  packagedManifest,
  shipsInExtension,
} from '../lib/extension-package.mjs';

const MANIFEST = {
  manifest_version: 3,
  name: 'Aevra Browser Control',
  version: '0.1.0',
  background: { service_worker: 'service-worker.js', type: 'module' },
  options_page: 'options.html',
  permissions: ['tabs'],
};

test('a plain version passes through', () => {
  assert.equal(normalizeVersion('1.2.3'), '1.2.3');
});

test('a prerelease or build suffix is dropped, because Chrome refuses it', () => {
  assert.equal(normalizeVersion('1.2.3-rc.1'), '1.2.3');
  assert.equal(normalizeVersion('1.2.3+build.5'), '1.2.3');
});

test('more than four components are trimmed to four', () => {
  assert.equal(normalizeVersion('1.2.3.4.5'), '1.2.3.4');
});

test('an unusable version falls back rather than emitting an unloadable manifest', () => {
  assert.equal(normalizeVersion(''), '0.0.0');
  assert.equal(normalizeVersion(undefined), '0.0.0');
  assert.equal(normalizeVersion('not-a-version'), '0.0.0');
});

test('the packaged manifest points at the compiled tree, not the flat names', () => {
  const manifest = packagedManifest(MANIFEST, '1.0.4');
  assert.equal(manifest.background.service_worker, `${EXTENSION_ROOT}/service-worker.js`);
  assert.equal(manifest.options_page, `${EXTENSION_ROOT}/options.html`);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.version, '1.0.4');
  assert.deepEqual(manifest.permissions, ['tabs']);
});

test('compiled tests are recognised as not shipping', () => {
  assert.equal(shipsInExtension('apps/extension/src/bridge.js'), true);
  assert.equal(shipsInExtension('apps/extension/src/bridge.test.js'), false);
  assert.equal(shipsInExtension('apps/extension/src/bridge.js.map'), false);
});

test('the entry list carries the manifest, the options page, and no test build', () => {
  const entries = extensionEntries({
    emitted: [
      { name: 'apps/extension/src/service-worker.js', data: Buffer.from('sw') },
      { name: 'apps/extension/src/bridge.test.js', data: Buffer.from('spec') },
      { name: 'packages/protocol/src/browser.js', data: Buffer.from('proto') },
    ],
    manifest: MANIFEST,
    optionsHtml: '<!doctype html>',
    version: '2.0.0',
  });
  const names = entries.map((entry) => entry.name).sort();

  assert.deepEqual(names, [
    'apps/extension/src/options.html',
    'apps/extension/src/service-worker.js',
    'manifest.json',
    'packages/protocol/src/browser.js',
  ]);
});

test('the shared packages the extension imports are kept, or its imports would break', () => {
  const entries = extensionEntries({
    emitted: [{ name: 'packages/browser/src/dom-snapshot.js', data: Buffer.from('shared') }],
    manifest: MANIFEST,
    optionsHtml: '<!doctype html>',
    version: '1.0.0',
  });
  assert.ok(entries.some((entry) => entry.name === 'packages/browser/src/dom-snapshot.js'));
});

test('the emitted manifest is valid json carrying the normalized version', () => {
  const entries = extensionEntries({
    emitted: [],
    manifest: MANIFEST,
    optionsHtml: '',
    version: '3.1.0-beta.2',
  });
  const manifest = JSON.parse(String(entries.find((entry) => entry.name === 'manifest.json').data));
  assert.equal(manifest.version, '3.1.0');
});

test('icons are included in the packaged extension entries', () => {
  const icons = [
    { name: 'icons/icon-16.png', data: Buffer.from('16') },
    { name: 'icons/icon-32.png', data: Buffer.from('32') },
    { name: 'icons/icon-48.png', data: Buffer.from('48') },
    { name: 'icons/icon-128.png', data: Buffer.from('128') },
  ];
  const entries = extensionEntries({
    emitted: [],
    manifest: MANIFEST,
    optionsHtml: '',
    version: '1.0.0',
    icons,
  });
  for (const icon of icons) {
    assert.ok(entries.some((entry) => entry.name === icon.name));
  }
});

test('the packaged manifest rewrites default_popup and packages popup.html', () => {
  const manifestWithPopup = {
    ...MANIFEST,
    action: {
      default_popup: 'popup.html',
      default_icon: { 16: 'icons/icon-16.png' },
    },
  };
  const entries = extensionEntries({
    emitted: [{ name: 'apps/extension/src/popup.js', data: Buffer.from('popup') }],
    manifest: manifestWithPopup,
    optionsHtml: '<!doctype html>',
    popupHtml: '<!doctype html><title>Popup</title>',
    version: '1.0.0',
  });
  const names = entries.map((entry) => entry.name).sort();
  assert.ok(names.includes('apps/extension/src/popup.html'));
  assert.ok(names.includes('apps/extension/src/popup.js'));

  const parsed = JSON.parse(String(entries.find((entry) => entry.name === 'manifest.json').data));
  assert.equal(parsed.action.default_popup, `${EXTENSION_ROOT}/popup.html`);
});
