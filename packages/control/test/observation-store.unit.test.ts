import assert from 'node:assert/strict';
import test from 'node:test';
import { ObservationStore } from '../src/observation-store.js';
import type { ControlObservation } from '../../protocol/src/control.js';

function observation(
  observationId: string,
  revision: number,
  nodes: ControlObservation['nodes'],
  options: Partial<
    Pick<ControlObservation, 'surfaceId' | 'generation' | 'policyRevision' | 'mode' | 'image'>
  > = {},
): ControlObservation {
  return {
    observationId,
    surfaceId: options.surfaceId ?? 'surface_settings',
    generation: options.generation ?? 1,
    revision,
    freshness: 'fresh',
    watchHealth: 'healthy',
    observedAt: `2026-09-22T09:00:0${revision}Z`,
    lastValidatedAt: `2026-09-22T09:00:0${revision}Z`,
    policyRevision: options.policyRevision ?? 1,
    mode: options.mode ?? 'sharedSemantic',
    coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
    nodes,
    ...(options.image === undefined ? {} : { image: options.image }),
  };
}

test('returns only changed nodes and removed refs for an owned baseline', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 3 });
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'name', role: 'textbox', name: 'Name', actions: [] }]),
  );
  store.record(
    'owner-a',
    observation('obs-2', 2, [
      { ref: 'name', role: 'textbox', name: 'Name', value: 'Aevra', actions: [] },
      { ref: 'save', role: 'button', name: 'Save', actions: [] },
    ]),
  );

  const result = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 10 });

  assert.equal(result.kind, 'delta');
  assert.deepEqual(
    result.upsert.map((node) => node.ref),
    ['name', 'save'],
  );
  assert.deepEqual(result.remove, []);
});

test('returns a full observation when the caller baseline was evicted', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 1 });
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'old', role: 'status', name: 'Old', actions: [] }]),
  );
  store.record(
    'owner-a',
    observation('obs-2', 2, [{ ref: 'new', role: 'status', name: 'New', actions: [] }]),
  );

  const result = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 10 });

  assert.equal(result.kind, 'full');
  assert.equal(result.observation.observationId, 'obs-2');
});

test('never exposes observations or deltas across owners', () => {
  const store = new ObservationStore();
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'save', role: 'button', name: 'Save', actions: [] }]),
  );

  assert.throws(
    () => store.delta('owner-b', 'surface_settings', 'obs-1', { maxNodes: 10 }),
    /CONTROL_OWNER_FORBIDDEN/,
  );
});

test('marks dirty state and releases all owner state', () => {
  const store = new ObservationStore();
  store.record('owner-a', observation('obs-1', 1, []));
  store.markDirty('owner-a', 'surface_settings', 'value-change');

  assert.equal(store.get('owner-a', 'surface_settings')?.freshness, 'dirty');
  store.release('owner-a');
  assert.equal(store.get('owner-a', 'surface_settings'), undefined);
});

test('invalidates the generation and revokes refs from the previous observation', () => {
  const store = new ObservationStore();
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'save', role: 'button', name: 'Save', actions: [] }]),
  );
  store.invalidate('owner-a', 'surface_settings', 'navigation');

  const result = store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 10 });

  assert.equal(result.kind, 'delta');
  assert.equal(result.freshness, 'unknown');
  assert.notEqual(result.observationId, 'obs-1');
  assert.deepEqual(result.remove, ['save']);
});

test('enforces the per-surface node bound', () => {
  const store = new ObservationStore({ maxNodesPerSurface: 1 });

  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('obs-1', 1, [
          { ref: 'one', role: 'button', name: 'One', actions: [] },
          { ref: 'two', role: 'button', name: 'Two', actions: [] },
        ]),
      ),
    /CONTROL_OBSERVATION_TOO_LARGE/,
  );
});

test('rejects late writes from revoked generations and older revisions or policies', () => {
  const store = new ObservationStore();
  store.record(
    'owner-a',
    observation('obs-1', 10, [{ ref: 'old', role: 'status', name: 'Old', actions: [] }]),
  );
  store.invalidate('owner-a', 'surface_settings', 'navigation');
  const validationEpoch = store.validationEpoch('owner-a', 'surface_settings');

  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('late-generation', 11, [
          { ref: 'old', role: 'status', name: 'Old', actions: [] },
        ]),
      ),
    /CONTROL_OBSERVATION_STALE/,
  );

  store.record(
    'owner-a',
    observation('obs-2', 12, [{ ref: 'new', role: 'status', name: 'New', actions: [] }], {
      generation: 2,
      policyRevision: 3,
    }),
    { validationEpoch },
  );
  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation(
          'older-revision',
          11,
          [{ ref: 'old', role: 'status', name: 'Old', actions: [] }],
          {
            generation: 2,
            policyRevision: 3,
          },
        ),
      ),
    /CONTROL_OBSERVATION_STALE/,
  );
  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation(
          'older-policy',
          13,
          [{ ref: 'old', role: 'status', name: 'Old', actions: [] }],
          {
            generation: 2,
            policyRevision: 2,
          },
        ),
      ),
    /CONTROL_OBSERVATION_STALE/,
  );
});

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
    actions: [] as const,
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

test('keeps owner-local LRU eviction separate from the global quota', () => {
  const store = new ObservationStore({ maxSurfacesPerOwner: 2, maxSurfacesTotal: 10 });
  const make = (owner: string, surfaceId: string, id: string) =>
    store.record(
      owner,
      observation(
        id,
        1,
        [{ ref: `${surfaceId}-node`, role: 'status', name: surfaceId, actions: [] }],
        {
          surfaceId,
        },
      ),
    );

  make('owner-b', 'b-1', 'b-1-observation');
  make('owner-b', 'b-2', 'b-2-observation');
  make('owner-a', 'a-1', 'a-1-observation');
  make('owner-a', 'a-2', 'a-2-observation');
  make('owner-a', 'a-3', 'a-3-observation');

  assert.ok(store.get('owner-b', 'b-1'));
  assert.ok(store.get('owner-b', 'b-2'));
  assert.equal(store.get('owner-a', 'a-1'), undefined);
  assert.ok(store.get('owner-a', 'a-3'));
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

test('repeated dirty events are idempotent and keep opaque ids bounded', () => {
  const store = new ObservationStore();
  store.record('owner-a', observation('obs-1', 1, []));
  store.markDirty('owner-a', 'surface_settings', 'value-change');
  const first = store.get('owner-a', 'surface_settings')!;

  for (let index = 0; index < 100; index += 1) {
    store.markDirty('owner-a', 'surface_settings', `event-${index}`);
  }
  const current = store.get('owner-a', 'surface_settings')!;

  assert.equal(current.observationId, first.observationId);
  assert.equal(current.revision, first.revision);
  assert.ok(current.observationId.length < 64);
});

test('fences pre-event reads and rejects reuse of retained observation ids', () => {
  const store = new ObservationStore({ maxHistoryPerSurface: 3 });
  store.record(
    'owner-a',
    observation('obs-1', 10, [{ ref: 'old', role: 'status', name: 'Old', actions: [] }]),
  );
  const readEpoch = store.validationEpoch('owner-a', 'surface_settings');
  store.markDirty('owner-a', 'surface_settings', 'value-change');

  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('obs-1', 10, [{ ref: 'old', role: 'status', name: 'Old', actions: [] }]),
        { validationEpoch: readEpoch },
      ),
    /CONTROL_OBSERVATION_STALE/,
  );

  const currentEpoch = store.validationEpoch('owner-a', 'surface_settings');
  store.record(
    'owner-a',
    observation('obs-2', 10, [{ ref: 'new', role: 'status', name: 'New', actions: [] }]),
    { validationEpoch: currentEpoch },
  );
  assert.throws(
    () =>
      store.record(
        'owner-a',
        observation('obs-1', 11, [
          { ref: 'changed', role: 'status', name: 'Changed', actions: [] },
        ]),
        { validationEpoch: currentEpoch },
      ),
    /CONTROL_OBSERVATION_IMMUTABLE|CONTROL_OBSERVATION_STALE/,
  );
});

test('keeps a newly recorded surface reachable when global eviction removes its owner map', () => {
  const store = new ObservationStore({ maxSurfacesPerOwner: 2, maxSurfacesTotal: 1 });
  store.record('owner-a', observation('a-1', 1, [], { surfaceId: 'surface_a' }));
  store.record('owner-a', observation('a-2', 2, [], { surfaceId: 'surface_b' }));

  assert.equal(store.get('owner-a', 'surface_a'), undefined);
  assert.equal(store.get('owner-a', 'surface_b')?.observationId, 'a-2');
});

test('keeps dirty and invalidated state safe when history has its own byte budget', () => {
  const store = new ObservationStore({
    maxBytesPerObservation: 1_000,
    maxBytesPerHistory: 2_500,
    maxHistoryPerSurface: 3,
  });
  store.record(
    'owner-a',
    observation('obs-1', 1, [{ ref: 'text', role: 'status', name: 'x'.repeat(400), actions: [] }]),
  );

  assert.doesNotThrow(() => store.markDirty('owner-a', 'surface_settings', 'value-change'));
  assert.equal(store.get('owner-a', 'surface_settings')?.freshness, 'dirty');
  assert.doesNotThrow(() => store.invalidate('owner-a', 'surface_settings', 'navigation'));
  assert.equal(store.get('owner-a', 'surface_settings')?.freshness, 'unknown');
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

test('fences a second distinct invalidation while a prior read is in flight', () => {
  const store = new ObservationStore();
  store.record('owner-a', observation('obs-1', 1, []));
  store.invalidate('owner-a', 'surface_settings', 'navigation-a', 'event-a');
  const intermediateEpoch = store.validationEpoch('owner-a', 'surface_settings');
  store.invalidate('owner-a', 'surface_settings', 'navigation-b', 'event-b');

  assert.equal(store.get('owner-a', 'surface_settings')?.generation, 3);
  assert.throws(
    () =>
      store.record('owner-a', observation('intermediate', 3, [], { generation: 2 }), {
        validationEpoch: intermediateEpoch,
      }),
    /CONTROL_OBSERVATION_STALE/,
  );
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

test('rejects a validated write after its surface was released', () => {
  const store = new ObservationStore();
  store.record('owner-a', observation('obs-1', 1, []));
  const validationEpoch = store.validationEpoch('owner-a', 'surface_settings');
  store.release('owner-a');

  assert.throws(
    () =>
      store.record('owner-a', observation('obs-2', 2, []), {
        validationEpoch,
      }),
    /CONTROL_OBSERVATION_STALE/,
  );
  assert.equal(store.get('owner-a', 'surface_settings'), undefined);
  assert.throws(
    () => store.delta('owner-a', 'surface_settings', 'obs-1', { maxNodes: 1 }),
    /CONTROL_OWNER_FORBIDDEN/,
  );
});
