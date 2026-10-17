type Schema = Record<string, unknown>;
const UNSUPPORTED = Symbol('unsupported schema');

function schemaObject(value: unknown): Schema | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : null;
}

function sample(value: unknown, depth: number, budget: { remaining: number }): unknown {
  if (depth > 5 || --budget.remaining < 0) return UNSUPPORTED;
  const schema = schemaObject(value);
  if (!schema) return UNSUPPORTED;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Object.hasOwn(schema, 'default')) return schema.default;
  if (Object.hasOwn(schema, 'const')) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (['$ref', 'allOf', 'not', 'if'].some((key) => Object.hasOwn(schema, key))) return UNSUPPORTED;
  const variant = [schema.oneOf, schema.anyOf].find(Array.isArray);
  if (variant?.length) return sample(variant[0], depth + 1, budget);
  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== 'null')
    : schema.type;
  if (type === 'object' || schema.properties) {
    const properties = schemaObject(schema.properties) ?? {};
    const entries = Object.entries(properties);
    if (entries.length > 20) return UNSUPPORTED;
    const values = entries.map(
      ([name, entry]) => [name, sample(entry, depth + 1, budget)] as const,
    );
    if (values.some(([, item]) => item === UNSUPPORTED)) return UNSUPPORTED;
    return Object.fromEntries(values);
  }
  if (type === 'array') {
    if (!schema.items) return [];
    const value = sample(schema.items, depth + 1, budget);
    return value === UNSUPPORTED ? UNSUPPORTED : [value];
  }
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  if (type === 'number' || type === 'integer')
    return typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (type === 'string') return 'example';
  return UNSUPPORTED;
}

export function inputExample(inputSchema: unknown): { label: string; value: unknown } | null {
  const schema = schemaObject(inputSchema);
  if (!schema) return null;
  if (Array.isArray(schema.examples) && schema.examples.length) {
    return { label: 'Server-provided example', value: schema.examples[0] };
  }
  if (Object.hasOwn(schema, 'default'))
    return { label: 'Server-provided default', value: schema.default };
  const value = sample(schema, 0, { remaining: 200 });
  if (value === UNSUPPORTED) return null;
  return {
    label: 'Illustrative example (from input schema; verify before use)',
    value,
  };
}

export function inputParameters(inputSchema: unknown) {
  const schema = schemaObject(inputSchema);
  const required = Array.isArray(schema?.required) ? schema.required : [];
  return Object.entries(schemaObject(schema?.properties) ?? {}).map(([name, value]) => {
    const property = schemaObject(value);
    const type = property?.type;
    return {
      name,
      required: required.includes(name),
      type:
        typeof type === 'string'
          ? type
          : Array.isArray(type)
            ? type.filter((item) => typeof item === 'string').join(' | ')
            : 'See schema',
      description: typeof property?.description === 'string' ? property.description : '',
    };
  });
}
