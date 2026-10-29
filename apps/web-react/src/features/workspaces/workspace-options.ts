export interface WorkspaceAdmission {
  actor: string;
  workspaceId: string;
  profileId: string;
  admission: 'auto' | 'ask';
  profileName?: string;
}

export const ADMISSION_PROFILE_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'coding-session', label: 'Coding Session' },
  { value: 'developer', label: 'Developer' },
  { value: 'full-workspace', label: 'Full Workspace' },
];

export const ADMISSION_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto-admit' },
  { value: 'ask', label: 'Ask every time' },
];

export const MOUNT_CAPABILITY_OPTIONS = [
  { value: 'read-only', label: 'Read Only' },
  { value: 'read-write', label: 'Read & Write' },
  { value: 'full', label: 'Full Access' },
];

export const MOUNT_CAPABILITY_MAP: Record<string, string[]> = {
  'read-only': ['files.read', 'files.search'],
  'read-write': ['files.read', 'files.search', 'files.write', 'files.delete'],
  full: ['files.read', 'files.search', 'files.write', 'files.delete', 'commands.run'],
};

export function getMountCapabilityPreset(capabilities?: string[]): string {
  if (!capabilities || capabilities.length === 0) return 'read-only';
  if (capabilities.includes('commands.run')) return 'full';
  if (capabilities.includes('files.write') || capabilities.includes('files.delete')) {
    return 'read-write';
  }
  return 'read-only';
}
