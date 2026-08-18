import type { AdminApiContext } from './types.js';

export const GUIDE_CHAPTERS = [
  { slug: 'quick-start', title: 'Quick start', file: '00-quick-start.md' },
  { slug: 'install', title: 'Install', file: '01-install.md' },
  { slug: 'first-start', title: 'First start', file: '02-first-start.md' },
  { slug: 'remote-access', title: 'Remote access', file: '03-remote-access.md' },
  { slug: 'connect-chatgpt', title: 'Connect ChatGPT', file: '04-connect-chatgpt.md' },
  { slug: 'connect-claude', title: 'Connect Claude', file: '05-connect-claude.md' },
  { slug: 'connect-gemini', title: 'Connect Gemini', file: '06-connect-gemini.md' },
  { slug: 'workspaces', title: 'Workspaces', file: '07-workspaces.md' },
  {
    slug: 'permissions-approvals',
    title: 'Permissions and approvals',
    file: '08-permissions-approvals.md',
  },
  { slug: 'skills', title: 'Skills', file: '09-skills.md' },
  {
    slug: 'changes-recovery',
    title: 'Changes and recovery',
    file: '10-changes-recovery.md',
  },
  { slug: 'processes', title: 'Processes', file: '11-processes.md' },
  { slug: 'service', title: 'Run as a service', file: '12-service.md' },
  {
    slug: 'security-authentication',
    title: 'Security and authentication',
    file: '13-security-authentication.md',
  },
  { slug: 'troubleshooting', title: 'Troubleshooting', file: '14-troubleshooting.md' },
  { slug: 'explore', title: 'Explore Aevra', file: '15-explore.md' },
  {
    slug: 'safe-command-matchers',
    title: 'Safe command matchers',
    file: '16-safe-command-matchers.md',
  },
] as const;

export const DEFAULT_ONBOARDING = {
  completed: false,
  completedSections: [] as string[],
};

export function onboardingState(value: any) {
  const sections = Array.isArray(value?.completedSections)
    ? value.completedSections
        .filter((item: any) => typeof item === 'string' && item.length <= 80)
        .slice(0, 32)
    : [];
  return {
    completed: value?.completed === true,
    completedSections: [...new Set(sections)],
  };
}

export function criticalPersistentRule(input: any): boolean {
  if (
    input?.effect !== 'allow' ||
    !['workspace', 'global'].includes(input?.scope)
  ) {
    return false;
  }
  const matcher = String(input?.matcher ?? '').toLowerCase();
  return (
    Boolean(input?.critical) ||
    /workspace[_:-]?escape|privilege|elevat|security:disable|git:(?:reset|clean|force-push)|git:push.*force/.test(
      matcher,
    )
  );
}

export function revision(context: AdminApiContext, key: string): number {
  return context.settings?.revision?.(key) ?? Date.now();
}
