import { createHash } from 'node:crypto';
import type { UpstreamCatalog } from './protocol.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, canonical(inner)]);
  }
  return value ?? null;
}

function line(parts: unknown[]): string {
  return JSON.stringify(parts.map(canonical));
}

function catalogEntries(catalog: UpstreamCatalog): {
  tools: Map<string, string>;
  resources: Map<string, string>;
  prompts: Map<string, string>;
} {
  return {
    tools: new Map(
      catalog.tools.map((tool) => [
        `tool:${tool.name}`,
        line([tool.name, tool.description ?? '', tool.inputSchema ?? null]),
      ]),
    ),
    resources: new Map(
      catalog.resources.map((resource) => [
        `resource:${resource.uri}`,
        line([resource.uri, resource.name ?? '', resource.description ?? '']),
      ]),
    ),
    prompts: new Map(
      catalog.prompts.map((prompt) => [
        `prompt:${prompt.name}`,
        line([prompt.name, prompt.description ?? '']),
      ]),
    ),
  };
}

export interface CatalogDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function catalogDiff(previous: UpstreamCatalog | null, next: UpstreamCatalog): CatalogDiff {
  const before = previous ? catalogEntries(previous) : null;
  const after = catalogEntries(next);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const group of ['tools', 'resources', 'prompts'] as const) {
    for (const [key, signature] of after[group]) {
      if (!before || !before[group].has(key)) added.push(key);
      else if (before[group].get(key) !== signature) changed.push(key);
    }
    if (before) {
      for (const key of before[group].keys()) if (!after[group].has(key)) removed.push(key);
    }
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

export function catalogFingerprint(catalog: UpstreamCatalog): string {
  const tools = catalog.tools
    .map((tool) => line([tool.name, tool.description ?? '', tool.inputSchema ?? null]))
    .sort();
  const resources = catalog.resources
    .map((resource) => line([resource.uri, resource.name ?? '', resource.description ?? '']))
    .sort();
  const prompts = catalog.prompts
    .map((prompt) => line([prompt.name, prompt.description ?? '']))
    .sort();
  const hash = createHash('sha256');
  hash.update(`tools\n${tools.join('\n')}\n`);
  hash.update(`resources\n${resources.join('\n')}\n`);
  hash.update(`prompts\n${prompts.join('\n')}\n`);
  return hash.digest('hex');
}
