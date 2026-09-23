import assert from 'node:assert/strict';
import test from 'node:test';
import { ObservationStore } from '../src/observation-store.js';
import { observation } from './observation-fixtures.js';

test('continues a truncated delta without acknowledging the destination early', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 3 });
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'old', role: 'status', name: 'Old', actions: [] }]),
  );
  store.record(
    'owner-a',
    observation('obs-2', 2, [{ ref: 'new', role: 'status', name: 'New', actions: [] }]),
  );

  const first = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 1 });
  assert.equal(first.kind, 'delta');
  assert.equal(first.complete, false);
  assert.equal(first.appliedObservationId, 'obs-1');
  assert.ok(first.continuation?.token);

  const second = store.delta('owner-a', 'surface_settings', 'obs-1', {
    maxNodes: 1,
    continuationToken: first.continuation!.token,
  });
  assert.equal(second.kind, 'delta');
  assert.equal(second.complete, true);
  assert.equal(second.appliedObservationId, 'obs-2');
  assert.deepEqual(
    second.upsert.map((node) => node.ref),
    ['new'],
  );
});

test('prunes nested observations against one shared node budget', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 1 });
  const children = Array.from({ length: 100 }, (_, index) => ({
    ref: `child-${index}`,
    role: 'button',
    name: `Child ${index}`,
    actions: [],
  }));
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'root', role: 'group', name: 'Root', actions: [], children }]),
  );

  const result = store.delta('owner-a', 'surface_settings', 'missing', { maxNodes: 1 });
  assert.equal(result.kind, 'full');
  assert.equal(result.observation.nodes.length, 1);
  assert.equal(result.observation.nodes[0]?.children, undefined);
  assert.equal(result.observation.coverage.omittedNodes, 100);
});

test('returns current metadata and image replacement state in deltas', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 3 });
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'save', role: 'button', name: 'Save', actions: [] }], {
      image: {
        dataUri: 'data:image/png;base64,old',
        capturedAt: '2026-09-22T09:00:00Z',
        devicePixelRatio: 1,
        viewport: { x: 0, y: 0, width: 10, height: 10 },
      },
    }),
  );
  store.record(
    'owner-a',
    observation('obs-2', 2, [{ ref: 'save', role: 'button', name: 'Save', actions: [] }], {
      policyRevision: 2,
    }),
  );

  const result = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 10 });
  assert.equal(result.kind, 'delta');
  assert.equal(result.metadata.policyRevision, 2);
  assert.equal(result.metadata.imageChanged, true);
  assert.equal(result.metadata.image, null);
});

test('bounds retained bytes, image size, and idle lifetime', () => {
  let now = 0;
  const store = new ObservationStore(
    {
      maxBytesPerObservation: 500,
      maxImageBytes: 100,
      idleRetentionMs: 10,
    },
    { now: () => now },
  );

  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('large-text', 1, [
          { ref: 'text', role: 'status', name: 'x'.repeat(600), actions: [] },
        ]),
      ),
    /CONTROL_OBSERVATION_TOO_LARGE/,
  );
  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('large-image', 1, [], {
          image: {
            dataUri: `data:image/png;base64,${'x'.repeat(101)}`,
            capturedAt: '2026-09-22T09:00:00Z',
            devicePixelRatio: 1,
            viewport: { x: 0, y: 0, width: 10, height: 10 },
          },
        }),
      ),
    /CONTROL_IMAGE_TOO_LARGE/,
  );

  store.record('owner-a', observation('idle', 1, []));
  now = 11;
  assert.equal(store.get('owner-a', 'surface_settings'), undefined);
});

test('continues a truncated full fallback without acknowledging the source early', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 1 });
  const image = {
    dataUri: 'data:image/png;base64,full',
    capturedAt: '2026-09-22T09:00:00Z',
    devicePixelRatio: 1,
    viewport: { x: 0, y: 0, width: 10, height: 10 },
  };
  store.record(
    'owner-a',
    observation(
      'obs-1',
      1,
      [
        { ref: 'one', role: 'status', name: 'One', actions: [] },
        { ref: 'two', role: 'status', name: 'Two', actions: [] },
      ],
      { image },
    ),
  );

  const first = store.delta('owner-a', 'surface_settings', 'missing', { maxNodes: 1 });
  assert.equal(first.kind, 'full');
  assert.equal(first.complete, false);
  assert.equal(first.appliedObservationId, undefined);
  assert.equal(first.observation.image?.dataUri, image.dataUri);
  assert.ok(first.continuation?.token);

  const second = store.delta('owner-a', 'surface_settings', 'missing', {
    maxNodes: 1,
    continuationToken: first.continuation!.token,
  });
  assert.equal(second.kind, 'full');
  assert.equal(second.complete, true);
  assert.equal(second.appliedObservationId, 'obs-1');
  assert.equal(second.observation.image, undefined);
  assert.deepEqual(
    second.observation.nodes.map((node) => node.ref),
    ['two'],
  );
});

test('sends changed image data once across delta pages and omits unchanged images', () => {
  const image = {
    dataUri: 'data:image/png;base64,image',
    capturedAt: '2026-09-22T09:00:00Z',
    devicePixelRatio: 1,
    viewport: { x: 0, y: 0, width: 10, height: 10 },
  };
  const store = new ObservationStore({ maxHistoryPerSurface: 3 });
  store.record('owner-a', observation('obs-1', 1, [], { image }));
  const nextImage = { ...image, dataUri: `${image.dataUri}-new` };
  store.record(
    'owner-a',
    observation(
      'obs-2',
      2,
      [
        { ref: 'one', role: 'status', name: 'One', actions: [] },
        { ref: 'two', role: 'status', name: 'Two', actions: [] },
      ],
      { image: nextImage },
    ),
  );

  const first = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 1 });
  assert.equal(first.kind, 'delta');
  assert.equal(first.metadata.imageChanged, true);
  assert.equal(first.metadata.image?.dataUri, nextImage.dataUri);

  const second = store.delta('owner-a', 'surface_settings', 'obs-1', {
    maxNodes: 1,
    continuationToken: first.continuation!.token,
  });
  assert.equal(second.kind, 'delta');
  assert.equal(second.metadata.image, undefined);
  assert.equal(second.metadata.imageChanged, false);
});

test('replaying a continuation token returns the same page instead of advancing it', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 2 });
  store.record('owner-a', observation('obs-1', 1, []));
  store.record(
    'owner-a',
    observation('obs-2', 2, [
      { ref: 'one', role: 'status', name: 'One', actions: [] },
      { ref: 'two', role: 'status', name: 'Two', actions: [] },
    ]),
  );

  const first = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 1 });
  const retry = store.delta('owner-a', 'surface_settings', 'obs-1', {
    maxNodes: 1,
    continuationToken: first.continuation!.token,
  });
  const replay = store.delta('owner-a', 'surface_settings', 'obs-1', {
    maxNodes: 1,
    continuationToken: first.continuation!.token,
  });
  assert.ok(replay.kind === 'delta' && retry.kind === 'delta');
  assert.deepEqual(
    replay.upsert.map((node) => node.ref),
    retry.upsert.map((node) => node.ref),
  );
  assert.equal(replay.complete, retry.complete);
});

test('rejects a continuation replay with a different page size', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 2 });
  store.record('owner-a', observation('obs-1', 1, []));
  store.record(
    'owner-a',
    observation('obs-2', 2, [
      { ref: 'one', role: 'status', name: 'One', actions: [] },
      { ref: 'two', role: 'status', name: 'Two', actions: [] },
      { ref: 'three', role: 'status', name: 'Three', actions: [] },
    ]),
  );

  const first = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 1 });
  assert.throws(
    () =>
      store.delta('owner-a', 'surface_settings', 'obs-1', {
        maxNodes: 2,
        continuationToken: first.continuation!.token,
      }),
    /CONTROL_DELTA_CONTINUATION_MISMATCH/,
  );
});
