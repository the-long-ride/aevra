import { normalizeLogicalPath } from './logical-path.js';

export type Sensitivity = 'NORMAL' | 'SENSITIVE' | 'SECRET';
export interface SensitivityInput {
  path: string;
  gitIgnored?: boolean;
  explicit?: Sensitivity;
  userPatterns?: Array<{ pattern: RegExp; class: Sensitivity }>;
  mountPolicy?: Sensitivity;
}

const sensitivityRank: Record<Sensitivity, number> = {
  NORMAL: 0,
  SENSITIVE: 1,
  SECRET: 2,
};

export function maxSensitivity(...values: Sensitivity[]): Sensitivity {
  let result: Sensitivity = 'NORMAL';
  for (const value of values) {
    if (sensitivityRank[value] > sensitivityRank[result]) result = value;
  }
  return result;
}

export function classifySensitivity(input: SensitivityInput): Sensitivity {
  if (input.explicit) return input.explicit;
  // Normalised BEFORE the patterns are tried, not after. These globs are
  // anchored (`^/?...$`), and the caller's `path` is whatever spelling a tool
  // call supplied - so `./aevra.json`, `sub/../aevra.json` and `aevra.json/`
  // all used to miss a pattern that `aevra.json` matched, while naming the
  // same file. That turned every declared `protectedPaths` entry into a
  // speed bump anyone could step around by rewriting the argument.
  const canonical = normalizeLogicalPath(input.path);
  for (const rule of input.userPatterns ?? []) if (rule.pattern.test(canonical)) return rule.class;
  if (input.mountPolicy) return input.mountPolicy;
  const p = canonical.toLowerCase(),
    base = p.split('/').pop() ?? '';
  if (
    base === '.env' ||
    base.startsWith('.env.') ||
    /id_(rsa|ed25519|ecdsa)$/.test(base) ||
    /\.pem$|\.p12$|\.pfx$|private[-_]?key/.test(base)
  )
    return 'SECRET';
  if (input.gitIgnored || /credentials|secrets?\.json|\.npmrc$|\.pypirc$/.test(base))
    return 'SENSITIVE';
  return 'NORMAL';
}

export function maskSecretFile(path: string, content: string) {
  if (path.toLowerCase().split(/[\\/]/).pop()?.startsWith('.env'))
    return content
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf('=');
        return i > 0 ? `${line.slice(0, i)}=[REDACTED]` : line;
      })
      .join('\n');
  return '[REDACTED SECRET FILE]';
}

export function maskSensitiveFile(_path: string, content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      const equals = line.indexOf('=');
      if (equals > 0) return `${line.slice(0, equals)}=[REDACTED]`;
      const jsonLike = line.match(/^(\s*["'][^"']+["']\s*:\s*)(.*?)(,?\s*)$/);
      if (jsonLike) return `${jsonLike[1]}"[REDACTED]"${jsonLike[3]}`;
      return '[REDACTED]';
    })
    .join('\n');
}
