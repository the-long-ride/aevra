import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessibleName,
  buildSnapshot,
  parseRef,
  RefRegistry,
  roleOf,
  type SnapshotElementLike,
} from '../src/dom-snapshot.js';

function el(
  tagName: string,
  attributes: Record<string, string> = {},
  children: SnapshotElementLike[] = [],
  text = '',
): SnapshotElementLike {
  return { tagName, attributes, children, textContent: text };
}

const page = el('body', {}, [
  el('h1', {}, [], 'Invoices'),
  el('button', { id: 'new' }, [], 'New invoice'),
  el('input', { type: 'text', 'aria-label': 'Search' }),
  el('a', { href: '/help' }, [], 'Help'),
]);

test('buildSnapshot assigns refs carrying the snapshot version', () => {
  const result = buildSnapshot(page, { version: 7, maxNodes: 50 });
  const button = result.nodes.find((node) => node.name === 'New invoice');
  assert.ok(button);
  assert.equal(button.role, 'button');
  const parsed = parseRef(button.ref);
  assert.equal(parsed.version, 7);
  assert.ok(parsed.index >= 0);
  assert.equal(result.elements[parsed.index]?.attributes.id, 'new');
});

test('buildSnapshot skips hidden elements', () => {
  const withHidden = el('body', {}, [el('button', { hidden: 'true' }, [], 'Ghost')]);
  const result = buildSnapshot(withHidden, { version: 1, maxNodes: 50 });
  assert.equal(result.nodes.length, 0);
});

test('buildSnapshot truncates at maxNodes and reports it', () => {
  const many = el(
    'body',
    {},
    Array.from({ length: 30 }, (_, i) => el('button', {}, [], `B${i}`)),
  );
  const result = buildSnapshot(many, { version: 1, maxNodes: 5 });
  assert.equal(result.nodes.length, 5);
  assert.equal(result.truncated, true);
});

test('a ref from an older snapshot version is stale, not silently rebound', () => {
  const registry = new RefRegistry();
  const first = registry.record(buildSnapshot(page, { version: 1, maxNodes: 50 }));
  const staleRef = first.nodes[0]!.ref;
  registry.record(buildSnapshot(page, { version: 2, maxNodes: 50 }));
  assert.throws(() => registry.resolve(staleRef), /BROWSER_REF_STALE/);
});

test('a ref from the current snapshot version resolves to its element', () => {
  const registry = new RefRegistry();
  const snapshot = registry.record(buildSnapshot(page, { version: 3, maxNodes: 50 }));
  const ref = snapshot.nodes.find((node) => node.role === 'button')!.ref;
  assert.equal(registry.resolve(ref).tagName, 'button');
});

test('roleOf maps input types and honours an explicit role', () => {
  const input = (type: string): SnapshotElementLike => el('input', { type });
  assert.equal(roleOf(input('checkbox')), 'checkbox');
  assert.equal(roleOf(input('radio')), 'radio');
  assert.equal(roleOf(input('submit')), 'button');
  assert.equal(roleOf(input('button')), 'button');
  assert.equal(roleOf(input('text')), 'textbox');
  assert.equal(roleOf(el('input', {})), 'textbox', 'a typeless input is a textbox');
  assert.equal(roleOf(el('a', { href: '/x' })), 'link');
  assert.equal(roleOf(el('select', {})), 'combobox');
  assert.equal(roleOf(el('textarea', {})), 'textbox');
  assert.equal(roleOf(el('h3', {})), 'heading');
  assert.equal(roleOf(el('span', { role: 'ALERT' })), 'alert', 'an explicit role wins, lowercased');
  assert.equal(roleOf(el('span', {})), 'span');
});

test('accessibleName prefers aria-label, then title, then placeholder, then text', () => {
  assert.equal(accessibleName(el('button', { 'aria-label': 'Label' }, [], 'Text')), 'Label');
  assert.equal(accessibleName(el('button', { title: 'Title' }, [], 'Text')), 'Title');
  assert.equal(accessibleName(el('img', { alt: 'Alt' })), 'Alt');
  assert.equal(accessibleName(el('input', { placeholder: 'Search here' })), 'Search here');
  assert.equal(accessibleName(el('button', {}, [], '  spaced   out  ')), 'spaced out');
});

test('an aria-hidden or inline-hidden element is skipped', () => {
  const page = el('body', {}, [
    el('button', { 'aria-hidden': 'true' }, [], 'Hidden by aria'),
    el('button', { style: 'display: none' }, [], 'Hidden by style'),
    el('button', { style: 'visibility:hidden' }, [], 'Hidden by visibility'),
    el('button', {}, [], 'Visible'),
  ]);
  const result = buildSnapshot(page, { version: 1, maxNodes: 50 });
  assert.deepEqual(
    result.nodes.map((node) => node.name),
    ['Visible'],
  );
});

test('a disabled element and a valued field are reported as such', () => {
  const field: SnapshotElementLike = {
    tagName: 'input',
    attributes: { type: 'text', disabled: 'true' },
    children: [],
    textContent: '',
    value: 'typed',
  };
  const result = buildSnapshot(el('body', {}, [field]), { version: 2, maxNodes: 10 });
  assert.equal(result.nodes[0]!.disabled, true);
  assert.equal(result.nodes[0]!.value, 'typed');
});

test('an unparseable ref yields a sentinel rather than throwing', () => {
  assert.deepEqual(parseRef('nonsense'), { version: -1, index: -1 });
  assert.deepEqual(parseRef(''), { version: -1, index: -1 });
});
