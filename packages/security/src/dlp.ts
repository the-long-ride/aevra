const tokenPatterns = [
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_\-]{16,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*\b/gi,
];
function entropy(s: string) {
  const map = new Map<string, number>();
  for (const c of s) map.set(c, (map.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of map.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
export interface DlpResult {
  text: string;
  redactionCount: number;
}
export function redactText(
  input: string,
  knownSecrets: string[] = [],
  userPatterns: RegExp[] = [],
): DlpResult {
  let text = input,
    count = 0;
  for (const secret of [...new Set(knownSecrets.filter((s) => s.length >= 4))].sort(
    (a, b) => b.length - a.length,
  )) {
    if (text.includes(secret)) {
      const parts = text.split(secret);
      count += parts.length - 1;
      text = parts.join('[REDACTED]');
    }
  }
  for (const re of [...tokenPatterns, ...userPatterns])
    text = text.replace(re, () => {
      count++;
      return '[REDACTED]';
    });
  text = text.replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, (m) => {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(m) || m.includes('/') || entropy(m) < 3.5) return m;
    count++;
    return '[REDACTED]';
  });
  return { text, redactionCount: count };
}

const structuredSecretKey =
  /(?:^|_)(?:token|secret|password|credential|passphrase|code_verifier)(?:$|_)/i;
const opaquePayloadKey = new Set(['content', 'patch']);

function collectStructuredSecrets(value: unknown, out: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredSecrets(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === 'env' && item && typeof item === 'object' && !Array.isArray(item)) {
      for (const envValue of Object.values(item as Record<string, unknown>)) {
        if (typeof envValue === 'string' && envValue.length >= 4) out.push(envValue);
      }
      continue;
    }
    if (structuredSecretKey.test(key) && typeof item === 'string' && item.length >= 4) {
      out.push(item);
      continue;
    }
    collectStructuredSecrets(item, out);
  }
}

export function sanitizeStructuredSecrets(value: unknown): unknown {
  const knownSecrets: string[] = [];
  collectStructuredSecrets(value, knownSecrets);

  const visit = (item: unknown, key?: string): unknown => {
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (!item || typeof item !== 'object') {
      if (typeof item !== 'string') return item;
      if ((key && opaquePayloadKey.has(key)) || (key && structuredSecretKey.test(key))) {
        return '[REDACTED]';
      }
      return redactText(item, knownSecrets).text;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const [childKey, childValue] of Object.entries(item as Record<string, unknown>)) {
      if (
        childKey.toLowerCase() === 'env' &&
        childValue &&
        typeof childValue === 'object' &&
        !Array.isArray(childValue)
      ) {
        result[childKey] = Object.fromEntries(
          Object.keys(childValue as Record<string, unknown>).map((name) => [name, '[REDACTED]']),
        );
        continue;
      }
      result[childKey] = visit(childValue, childKey);
    }
    return result;
  };

  return visit(value);
}
