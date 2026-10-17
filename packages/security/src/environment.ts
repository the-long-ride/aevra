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

function safeBaseEnvironment(
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
  validateExplicitEnvironment(explicit);
  const base = safeBaseEnvironment(source, platform, extraAllowedKeys);
  if (platform !== 'win32') {
    return { ...base, ...explicit };
  }

  const explicitKeys = new Set(Object.keys(explicit).map((key) => key.toUpperCase()));
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (!explicitKeys.has(key.toUpperCase())) merged[key] = value;
  }
  return { ...merged, ...explicit };
}

const HIJACK_ENV =
  /^(?:LD_.*|DYLD_.*|NODE_OPTIONS|NODE_PATH|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|BASH_ENV|ENV|PROMPT_COMMAND|SHELLOPTS|BASHOPTS|PSMODULEPATH|GIT_SSH.*|GIT_EXEC_PATH|GIT_CONFIG.*|COMSPEC)$/i;

export function validateExplicitEnvironment(env: Record<string, string>) {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    if (
      !/^[a-z_][a-z0-9_]*$/i.test(key) ||
      HIJACK_ENV.test(key) ||
      typeof value !== 'string' ||
      value.includes('\0') ||
      keys.has(upper)
    ) {
      throw Object.assign(new Error(`Unsafe explicit environment variable: ${key}`), {
        code: 'INVALID_REQUEST',
      });
    }
    keys.add(upper);
  }
}

export function environmentNeedsApproval(env: Record<string, string> = {}) {
  return Object.keys(env).some((key) =>
    /^(?:PATH|GIT_.*|HOME|USERPROFILE|SHELL|PATHEXT)$/i.test(key),
  );
}
