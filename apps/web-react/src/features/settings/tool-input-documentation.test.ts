import { expect, test } from 'vitest';
import { inputExample, inputParameters } from './tool-input-documentation';

test('prefers supplied examples and preserves false, zero and null defaults', () => {
  expect(inputExample({ examples: [{ path: '/docs' }], default: {} })?.value).toEqual({
    path: '/docs',
  });
  for (const value of [false, 0, null]) {
    expect(inputExample({ default: value })).toEqual({ label: 'Server-provided default', value });
  }
});

test('illustrates nested arguments using enum, const, defaults, arrays and primitive types', () => {
  const result = inputExample({
    type: 'object',
    properties: {
      action: { enum: ['read', 'write'] },
      version: { const: 1 },
      enabled: { type: 'boolean' },
      limit: { type: 'integer', minimum: 2 },
      offset: { type: 'number' },
      names: { type: 'array', items: { type: 'string' } },
      empty: { type: 'array' },
      nullable: { type: ['null', 'string'] },
      nullOnly: { type: 'null' },
      nested: { type: 'object', properties: { path: { examples: ['/readme'] } } },
      choice: { anyOf: [{ type: 'string' }] },
    },
  });
  expect(result?.value).toEqual({
    action: 'read',
    version: 1,
    enabled: false,
    limit: 2,
    offset: 0,
    names: ['example'],
    empty: [],
    nullable: 'example',
    nullOnly: null,
    nested: { path: '/readme' },
    choice: 'example',
  });
  expect(result?.label).toContain('Illustrative example');
});

test('does not invent arguments for unresolved references, unsupported or excessive schemas', () => {
  expect(inputExample({ $ref: '#/$defs/input' })).toBeNull();
  expect(
    inputExample({ type: 'object', properties: { path: { $ref: '#/$defs/path' } } }),
  ).toBeNull();
  const recursive: Record<string, unknown> = { type: 'object' };
  recursive.properties = { child: recursive };
  expect(inputExample(recursive)).toBeNull();
  expect(
    inputExample({
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`p${index}`, { type: 'string' }]),
      ),
    }),
  ).toBeNull();
  for (const invalid of [undefined, null, false, [], 'schema'])
    expect(inputExample(invalid)).toBeNull();
});

test('preserves unusual parameter names without polluting object prototypes', () => {
  const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
  const value = inputExample(schema)?.value;
  expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
});

test('describes required parameters, union types and absent parameter metadata', () => {
  expect(
    inputParameters({
      required: ['path'],
      properties: { path: { type: ['string', 'null'], description: 'A path' }, options: {} },
    }),
  ).toEqual([
    { name: 'path', type: 'string | null', description: 'A path', required: true },
    { name: 'options', type: 'See schema', description: '', required: false },
  ]);
  expect(inputParameters(null)).toEqual([]);
});
