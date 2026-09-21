import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHOR,
  AUTHOR_NOTE,
  AUTHOR_PROFILE_URL,
  ISSUES_URL,
  LLM_TXT_BLOB_URL,
  LLM_TXT_URL,
  REPOSITORY_URL,
} from '../src/about.js';

test('about constants provide accurate author and repository links', () => {
  assert.equal(AUTHOR, 'the-long-ride');
  assert.equal(AUTHOR_NOTE, 'made by <3');
  assert.equal(AUTHOR_PROFILE_URL, 'https://github.com/the-long-ride');
  assert.equal(REPOSITORY_URL, 'https://github.com/the-long-ride/aevra');
  assert.equal(ISSUES_URL, 'https://github.com/the-long-ride/aevra/issues');
  assert.equal(LLM_TXT_URL, 'https://raw.githubusercontent.com/the-long-ride/aevra/main/llm.txt');
  assert.equal(LLM_TXT_BLOB_URL, 'https://github.com/the-long-ride/aevra/blob/main/llm.txt');
});
