import type { SnapshotElementLike } from '../src/dom-snapshot.js';

/**
 * The single page every transport is measured against. It carries one heading,
 * one clickable button with a box, and one password field, so the conformance
 * suite can assert refs, coordinate clicks, and the credential refusal without
 * a real browser.
 */
export const FIXTURE_PAGE: SnapshotElementLike = {
  tagName: 'body',
  attributes: {},
  textContent: 'Invoices',
  children: [
    { tagName: 'h1', attributes: {}, children: [], textContent: 'Invoices' },
    {
      tagName: 'button',
      attributes: { id: 'new' },
      children: [],
      textContent: 'New invoice',
      box: { x: 10, y: 10, width: 100, height: 30 },
    },
    {
      tagName: 'input',
      attributes: { type: 'password', name: 'password' },
      children: [],
      textContent: '',
    },
  ],
};
