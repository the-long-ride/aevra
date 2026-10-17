import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDiff,
  isPendingReview,
  isReviewable,
  reviewHint,
  type McpReviewRow,
} from '../src/commands/mcp-review-format.js';

function row(overrides: Partial<McpReviewRow> = {}): McpReviewRow {
  return {
    id: 'mu_1',
    name: 'engram',
    state: 'needs-review',
    enabled: true,
    pendingCatalogDiff: { added: ['tool:a', 'tool:b'], removed: [], changed: ['tool:c'] },
    pendingCatalogFingerprint: 'fingerprintvalue-long',
    ...overrides,
  };
}

test('reviewHint reviewable', () => {
  assert.equal(
    reviewHint(row()),
    '[aevra] engram changed its catalog (+2 added, -0 removed, ~1 changed). Run: aevra mcp review mu_1',
  );
});
test('reviewHint removed-only', () => {
  const removedOnly = row({
    pendingCatalogDiff: { added: [], removed: ['tool:x', 'tool:y', 'prompt:z'], changed: [] },
  });
  assert.equal(isReviewable(removedOnly), true);
  assert.equal(
    reviewHint(removedOnly),
    '[aevra] engram changed its catalog (+0 added, -3 removed, ~0 changed). Run: aevra mcp review mu_1',
  );
});
test('reviewHint blocked', () => {
  const blocked = row({ pendingCatalogDiff: null, pendingCatalogFingerprint: null });
  assert.equal(isReviewable(blocked), false);
  assert.equal(
    reviewHint(blocked),
    '[aevra] engram is blocked pending review. Run: aevra mcp test mu_1',
  );
});
test('formatDiff splits on first colon', () => {
  const lines = formatDiff(
    row({
      pendingCatalogDiff: { added: [], removed: [], changed: ['resource:repo:///readme'] },
    }),
  );
  assert.ok(lines.includes('  resource repo:///readme'));
});
test('formatDiff groups, omits empty groups and ends with a fingerprint prefix', () => {
  assert.deepEqual(
    formatDiff(
      row({
        pendingCatalogDiff: { added: ['tool:a'], removed: ['prompt:b'], changed: [] },
      }),
    ),
    ['Added:', '  tool a', 'Removed:', '  prompt b', 'Fingerprint: fingerprintv'],
  );
});
test('formatDiff of a blocked row is empty', () => {
  assert.deepEqual(formatDiff(row({ pendingCatalogDiff: null })), []);
});
test('isPendingReview ignores disabled', () => {
  assert.equal(isPendingReview(row({ enabled: false })), false);
  assert.equal(isPendingReview(row({ enabled: undefined })), true);
  assert.equal(isPendingReview(row()), true);
  assert.equal(isPendingReview(row({ state: 'active' })), false);
});
