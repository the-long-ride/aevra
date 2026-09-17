import { classifyOrigin } from '../../browser/src/origin-policy.js';
import type { OriginPolicyConfig } from '../../browser/src/origin-policy.js';
import { redactText } from '../../security/src/dlp.js';

/** Values that are pixels rather than text, so DLP has nothing to read. */
const NOT_TEXT = new Set(['imageDataUri']);

export interface RedactedBrowserResult {
  value: unknown;
  redactionCount: number;
}

/**
 * Runs page-derived text through the shared DLP classifier before it leaves the
 * tool. Page content is the one surface that reaches the model verbatim, so an
 * API key rendered in a web console used to come back intact.
 *
 * The shared pass is used rather than a browser-specific ruleset: a false
 * positive here corrupts what the agent sees on the page, so this content is
 * judged by exactly the classifier every other surface is judged by.
 */
export function redactBrowserResult(input: unknown): RedactedBrowserResult {
  let redactionCount = 0;
  const visit = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key !== undefined && NOT_TEXT.has(key)) return value;
      const result = redactText(value);
      redactionCount += result.redactionCount;
      return result.text;
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry, key));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = visit(childValue, childKey);
    }
    return out;
  };
  return { value: visit(input), redactionCount };
}

/**
 * Restamps every `originClass` a driver produced using the operator's policy.
 *
 * The drivers run in the worker, which holds no policy state, so `CdpDriver`
 * classifies against the default ports and the extension reports whatever the
 * browser told it. Both can call a configured Aevra port NORMAL. The gate
 * already re-derives the class it acts on; this makes the field the model reads
 * agree with the field the gate decided on.
 */
export function reclassifyOrigins(value: unknown, policy?: Partial<OriginPolicyConfig>): unknown {
  const restamp = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object') return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.url === 'string' && 'originClass' in record) {
      record.originClass = classifyOrigin(record.url, policy);
    }
    return entry;
  };
  if (Array.isArray(value)) {
    for (const entry of value) restamp(entry);
    return value;
  }
  return restamp(value);
}
