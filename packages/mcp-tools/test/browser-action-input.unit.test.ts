import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserActions } from '../src/browser-action-input.js';

test('both supported click shapes produce a canonical action, including zero coordinates', () => {
  assert.deepEqual(
    normalizeBrowserActions([{ click: { x: 0, y: 0 } }, { op: 'click', x: 355, y: 550 }]),
    [
      { op: 'click', x: 0, y: 0 },
      { op: 'click', x: 355, y: 550 },
    ],
  );
});

test('malformed actions identify their index before reaching a driver', () => {
  for (const action of [
    {},
    { click: {} },
    { click: { x: 12 } },
    { click: { x: Number.POSITIVE_INFINITY, y: 4 } },
    { click: { x: 1, y: 2 }, type: { text: 'x' } },
    { op: 'click', click: { x: 1, y: 2 } },
    { op: 'unknown' },
    { op: 'press_key', key: '' },
    { op: 'type', selector: '#x' },
  ]) {
    assert.throws(
      () => normalizeBrowserActions([{ op: 'press_key', key: 'Enter' }, action]),
      (error: any) => error.code === 'INVALID_REQUEST' && /actions\[1\]/.test(error.message),
      JSON.stringify(action),
    );
  }
});

test('nested type and select preserve outbound values for the security scanner', () => {
  assert.deepEqual(
    normalizeBrowserActions([
      { type: { selector: '#note', text: 'hello', clear: true } },
      { select: { ref: 'ref_1_3', value: 'blue' } },
    ]),
    [
      { op: 'type', selector: '#note', text: 'hello', clear: true },
      { op: 'select', ref: 'ref_1_3', value: 'blue' },
    ],
  );
});

test('flat and nested drag actions preserve both screenshot coordinate pairs', () => {
  assert.deepEqual(
    normalizeBrowserActions([
      { op: 'drag', x: 0, y: 10, toX: 120, toY: 60 },
      { drag: { x: 20, y: 30, toX: 90, toY: 130 } },
    ]),
    [
      { op: 'drag', x: 0, y: 10, toX: 120, toY: 60 },
      { op: 'drag', x: 20, y: 30, toX: 90, toY: 130 },
    ],
  );
});

test('a drag missing either endpoint is rejected before reaching a driver', () => {
  for (const drag of [
    { x: 10, y: 20, toX: 30 },
    { x: 10, y: 20, toX: Number.POSITIVE_INFINITY, toY: 40 },
    { x: 10, y: 20, toX: 30, toY: 40, selector: '#target' },
  ]) {
    assert.throws(
      () => normalizeBrowserActions([{ drag }]),
      (error: any) => error.code === 'INVALID_REQUEST' && /actions\[0\]/.test(error.message),
    );
  }
});
