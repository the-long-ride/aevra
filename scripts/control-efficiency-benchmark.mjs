import { performance } from 'node:perf_hooks';

const dist = process.env.AEVRA_BENCHMARK_DIST ?? '.test-dist';
const { PlanExecutor } = await import(`../${dist}/packages/control/src/plan-executor.js`);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

class Adapter {
  constructor(surfaceId) {
    this.surfaceId = surfaceId;
    this.mode = 'sharedSemantic';
    this.revision = 1;
    this.field = 'before';
    this.selected = 'one';
    this.toggle = 'off';
    this.status = '';
  }
  capabilities() {
    return {
      semantic: true,
      isolation: 'shared',
      capture: false,
      watch: false,
      attribution: true,
      actions: ['setValue', 'select', 'setToggleState', 'invoke'],
      limitations: ['synthetic benchmark adapter'],
    };
  }
  observation(id = `obs_${this.surfaceId}_${this.revision}`) {
    const now = '2026-09-22T00:00:00.000Z';
    return {
      observationId: id,
      surfaceId: this.surfaceId,
      generation: 1,
      revision: this.revision,
      freshness: 'fresh',
      watchHealth: 'degraded',
      observedAt: now,
      lastValidatedAt: now,
      policyRevision: 1,
      mode: this.mode,
      coverage: { scope: 'surface', truncated: false, omittedNodes: 0 },
      nodes: [
        {
          ref: 'field',
          role: 'textbox',
          name: 'Display name',
          value: this.field,
          enabled: true,
          actions: ['setValue'],
        },
        {
          ref: 'select',
          role: 'listitem',
          name: 'Choice',
          value: this.selected,
          enabled: true,
          actions: ['select'],
        },
        {
          ref: 'toggle',
          role: 'checkbox',
          name: 'Enabled',
          toggleState: this.toggle,
          enabled: true,
          actions: ['setToggleState'],
        },
        { ref: 'save', role: 'button', name: 'Save', enabled: true, actions: ['invoke'] },
        { ref: 'status', role: 'status', name: this.status, enabled: true, actions: [] },
      ],
    };
  }
  async observe() {
    return this.observation();
  }
  async dispatch(_target, action) {
    if (action.op === 'setValue') this.field = action.value;
    else if (action.op === 'select') this.selected = action.value;
    else if (action.op === 'setToggleState') this.toggle = action.state;
    else if (action.op === 'invoke') this.status = action.label ?? 'Saved';
    this.revision++;
    return { dispatched: true, outcome: 'completed' };
  }
}

const step = (id, surfaceId, target, action, postcondition, dependsOn = []) => ({
  id,
  surfaceId,
  dependsOn,
  target,
  action,
  preconditions: [{ kind: 'enabled', equals: true }],
  postcondition,
  timeoutMs: 1000,
});

const workflows = [
  {
    name: 'fill-save-form',
    surfaces: ['desktop:form'],
    steps: (s) => [
      step(
        'fill',
        s[0],
        { ref: 'field' },
        { op: 'setValue', value: 'Team' },
        { kind: 'valueEquals', value: 'Team' },
      ),
      step(
        'save',
        s[0],
        {
          locator: {
            scope: 'surface',
            role: 'button',
            name: 'Save',
            match: 'exact',
            requireUnique: true,
          },
        },
        { op: 'invoke', label: 'Saved' },
        { kind: 'textPresent', scope: 'surface', text: 'Saved' },
        ['fill'],
      ),
    ],
  },
  {
    name: 'select-save-dynamic-item',
    surfaces: ['desktop:list'],
    steps: (s) => [
      step(
        'select',
        s[0],
        { ref: 'select' },
        { op: 'select', value: 'two' },
        { kind: 'valueEquals', value: 'two' },
      ),
      step(
        'save',
        s[0],
        {
          locator: {
            scope: 'surface',
            role: 'button',
            name: 'Save',
            match: 'exact',
            requireUnique: true,
          },
        },
        { op: 'invoke', label: 'Selected' },
        { kind: 'textPresent', scope: 'surface', text: 'Selected' },
        ['select'],
      ),
    ],
  },
  {
    name: 'native-settings-form',
    surfaces: ['desktop:settings'],
    steps: (s) => [
      step(
        'name',
        s[0],
        { ref: 'field' },
        { op: 'setValue', value: 'Aevra' },
        { kind: 'valueEquals', value: 'Aevra' },
      ),
      step(
        'toggle',
        s[0],
        {
          locator: {
            scope: 'surface',
            role: 'checkbox',
            name: 'Enabled',
            match: 'exact',
            requireUnique: true,
          },
        },
        { op: 'setToggleState', state: 'on' },
        { kind: 'toggleStateEquals', state: 'on' },
        ['name'],
      ),
      step(
        'save',
        s[0],
        {
          locator: {
            scope: 'surface',
            role: 'button',
            name: 'Save',
            match: 'exact',
            requireUnique: true,
          },
        },
        { op: 'invoke', label: 'Saved' },
        { kind: 'textPresent', scope: 'surface', text: 'Saved' },
        ['toggle'],
      ),
    ],
  },
  {
    name: 'two-independent-surfaces',
    surfaces: ['desktop:left', 'desktop:right'],
    maxConcurrency: 2,
    steps: (s) => [
      step(
        'left',
        s[0],
        { ref: 'field' },
        { op: 'setValue', value: 'Left' },
        { kind: 'valueEquals', value: 'Left' },
      ),
      step(
        'right',
        s[1],
        { ref: 'field' },
        { op: 'setValue', value: 'Right' },
        { kind: 'valueEquals', value: 'Right' },
      ),
    ],
  },
  {
    name: 'modal-and-stop',
    surfaces: ['desktop:modal'],
    steps: (s) => [
      step(
        'open',
        s[0],
        { ref: 'save' },
        { op: 'invoke', label: 'Modal open' },
        { kind: 'textPresent', scope: 'surface', text: 'Modal open' },
      ),
    ],
  },
];

async function planRun(workflow, iteration) {
  const adapters = workflow.surfaces.map((id) => new Adapter(id));
  const executor = new PlanExecutor();
  const expectedObservations = {};
  let observationBytes = 0;
  for (const adapter of adapters) {
    const observation = adapter.observation(`base_${iteration}_${adapter.surfaceId}`);
    expectedObservations[adapter.surfaceId] = observation.observationId;
    executor.observations.record('benchmark', observation);
    observationBytes += Buffer.byteLength(JSON.stringify(observation));
  }
  const plan = {
    schemaVersion: 1,
    requestId: `req_${workflow.name}_${iteration}`,
    surfaceIds: workflow.surfaces,
    expectedObservations,
    mode: 'sharedSemantic',
    deadlineMs: 5000,
    maxConcurrency: workflow.maxConcurrency ?? 1,
    steps: workflow.steps(workflow.surfaces),
    output: { kind: 'full', maxOutputTokens: 1000 },
  };
  const started = performance.now();
  const result = await executor.execute(
    'benchmark',
    plan,
    new Map(adapters.map((adapter) => [adapter.surfaceId, adapter])),
  );
  const elapsed = performance.now() - started;
  if (result.status !== 'completed') throw new Error(`${workflow.name}: ${result.status}`);
  return {
    elapsed,
    modelFacingBytes: observationBytes + Buffer.byteLength(JSON.stringify(result)),
  };
}

async function legacyRun(workflow) {
  const adapters = new Map(workflow.surfaces.map((id) => [id, new Adapter(id)]));
  let modelFacingBytes = 0;
  for (const adapter of adapters.values()) {
    modelFacingBytes += Buffer.byteLength(JSON.stringify(await adapter.observe()));
  }
  const completed = new Set();
  for (const definition of workflow.steps(workflow.surfaces)) {
    if (!definition.dependsOn.every((id) => completed.has(id)))
      throw new Error('invalid benchmark workflow');
    const adapter = adapters.get(definition.surfaceId);
    await adapter.dispatch(definition.target, definition.action);
    modelFacingBytes += Buffer.byteLength(JSON.stringify(await adapter.observe()));
    completed.add(definition.id);
  }
  return { modelFacingBytes };
}

const WARMUPS = 5;
const RUNS = 30;
const report = [];
for (const workflow of workflows) {
  for (let i = 0; i < WARMUPS; i++) await planRun(workflow, `warmup_${i}`);
  const timings = [];
  const bytes = [];
  for (let i = 0; i < RUNS; i++) {
    const result = await planRun(workflow, i);
    timings.push(result.elapsed);
    bytes.push(result.modelFacingBytes);
  }
  const legacy = await legacyRun(workflow);
  const steps = workflow.steps(workflow.surfaces).length;
  const legacyCalls = workflow.surfaces.length + steps * 2;
  const planCalls = workflow.surfaces.length + 1;
  report.push({
    workflow: workflow.name,
    repetitions: RUNS,
    planLocalMsP50: Number(percentile(timings, 0.5).toFixed(3)),
    planLocalMsP95: Number(percentile(timings, 0.95).toFixed(3)),
    legacyModelCalls: legacyCalls,
    planModelCalls: planCalls,
    modelCallReductionPct: Number(((1 - planCalls / legacyCalls) * 100).toFixed(1)),
    legacyModelFacingJsonBytes: legacy.modelFacingBytes,
    planModelFacingJsonBytesMedian: Math.round(percentile(bytes, 0.5)),
    jsonByteReductionPct: Number(
      ((1 - percentile(bytes, 0.5) / legacy.modelFacingBytes) * 100).toFixed(1),
    ),
  });
}
const totalLegacyCalls = report.reduce((sum, row) => sum + row.legacyModelCalls, 0);
const totalPlanCalls = report.reduce((sum, row) => sum + row.planModelCalls, 0);
console.log(
  JSON.stringify(
    {
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      warmups: WARMUPS,
      repetitions: RUNS,
      aggregateStructuralModelCallReductionPct: Number(
        ((1 - totalPlanCalls / totalLegacyCalls) * 100).toFixed(1),
      ),
      report,
    },
    null,
    2,
  ),
);
