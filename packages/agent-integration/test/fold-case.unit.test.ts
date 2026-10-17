import assert from 'node:assert/strict';
import test from 'node:test';
import { foldsCase, rootKey } from '../src/claude-project-key.js';

test('foldsCase is true only where file systems usually ignore case', () => {
  assert.equal(foldsCase('win32'), true);
  assert.equal(foldsCase('darwin'), true);
  assert.equal(foldsCase('linux'), false);
  assert.equal(rootKey('F:/Work/Site', 'win32'), rootKey('f:\\work\\site\\', 'win32'));
  assert.notEqual(rootKey('/src/Proj', 'linux'), rootKey('/src/proj', 'linux'));
});
