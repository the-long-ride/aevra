/** Walk schema positions only: const/default/enum/examples contain ordinary JSON data. */
const MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);
const SINGLE = new Set([
  'additionalProperties',
  'additionalItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentSchema',
]);
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

export function sanitizeSchema(
  schema: Record<string, unknown>,
  describe: (value: string) => string,
): Record<string, unknown> {
  // Reject unsupported size/depth rather than silently changing validation semantics.
  let nodes = 0;
  function check(value: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 64)
      throw new Error('Upstream schema exceeds structural limits');
    if (value && typeof value === 'object')
      for (const entry of Object.values(value)) check(entry, depth + 1);
  }
  check(schema, 0);
  if (JSON.stringify(schema).length > 1024 * 1024)
    throw new Error('Upstream schema exceeds size limit');
  function visit(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (
          (key === 'description' || key === 'title' || key === '$comment') &&
          typeof entry === 'string'
        )
          return [key, describe(entry)];
        if (MAPS.has(key) || key === 'dependencies') {
          if (entry && typeof entry === 'object' && !Array.isArray(entry))
            return [
              key,
              Object.fromEntries(
                Object.entries(entry).map(([name, nested]) => [name, visit(nested)]),
              ),
            ];
        } else if (SINGLE.has(key) || key === 'items') {
          return [key, Array.isArray(entry) ? entry.map(visit) : visit(entry)];
        } else if (ARRAYS.has(key) && Array.isArray(entry)) return [key, entry.map(visit)];
        return [key, entry];
      }),
    );
  }
  return visit(schema) as Record<string, unknown>;
}
