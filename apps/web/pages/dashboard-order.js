const RUNTIME_SECTIONS = [
  'runtime-overview',
  'active-connections',
  'tool-activity',
  'connections',
  'recent-activity',
];

export function dashboardOrder(completed) {
  return completed
    ? [...RUNTIME_SECTIONS, 'onboarding']
    : ['onboarding', ...RUNTIME_SECTIONS];
}
