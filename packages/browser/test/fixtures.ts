import type { SnapshotElementLike } from '../src/dom-snapshot.js';

/**
 * The single page every transport is measured against. It carries one heading,
 * one clickable button with a box, and one password field, so the conformance
 * suite can assert refs, coordinate clicks, and the credential refusal without
 * a real browser.
 */
export const FIXTURE_PAGE: SnapshotElementLike = {
  elementId: 'fixture-body',
  tagName: 'body',
  attributes: {},
  textContent: 'Invoices',
  children: [
    {
      elementId: 'fixture-heading',
      tagName: 'h1',
      attributes: {},
      children: [],
      textContent: 'Invoices',
    },
    {
      elementId: 'fixture-button',
      tagName: 'button',
      attributes: { id: 'new' },
      children: [],
      textContent: 'New invoice',
      box: { x: 10, y: 10, width: 100, height: 30 },
    },
    {
      elementId: 'fixture-password',
      tagName: 'input',
      attributes: { type: 'password', name: 'password' },
      children: [],
      textContent: '',
    },
  ],
};
