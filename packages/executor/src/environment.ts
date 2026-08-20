const COMMON_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
]);

const WINDOWS_KEYS = new Set([
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'SYSTEMDRIVE',
  'USERPROFILE',
]);

export function safeBaseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  extraAllowedKeys: readonly string[] = [],
): Record<string, string> {
  const allowed = new Set(
    platform === 'win32' ? [...COMMON_KEYS, ...WINDOWS_KEYS] : [...COMMON_KEYS],
  );
  for (const key of extraAllowedKeys) allowed.add(key.toUpperCase());

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || !allowed.has(key.toUpperCase())) continue;
    result[key] = value;
  }
  return result;
}

export function buildChildEnvironment(
  explicit: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  extraAllowedKeys: readonly string[] = [],
): Record<string, string> {
  return {
    ...safeBaseEnvironment(source, platform, extraAllowedKeys),
    ...explicit,
  };
}
