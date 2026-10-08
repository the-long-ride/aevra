import type { TokenUsageReport } from '@aevra/admin-contracts';

const zero = {
  calls: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  savedTokens: 0,
  avgDurationMs: 0,
};

export function tokenUsageReport(over: Partial<TokenUsageReport> = {}): TokenUsageReport {
  return {
    estimator: 'heuristic-v1',
    range: '24h',
    granularity: 'hour',
    totals: { ...zero },
    today: { ...zero },
    topToolToday: null,
    series: [],
    byTool: [],
    byConnector: [],
    ...over,
  };
}

export function connectorProfilesFixture() {
  return {
    groups: [
      'files',
      'commands',
      'git',
      'changes',
      'skills',
      'browser',
      'desktop',
      'control',
      'upstream',
    ],
    groupTokens: {
      core: 3200,
      files: 1700,
      commands: 3000,
      git: 900,
      changes: 350,
      skills: 600,
      browser: 2500,
      desktop: 2200,
      control: 650,
      upstream: 0,
    },
    entries: [],
  };
}
