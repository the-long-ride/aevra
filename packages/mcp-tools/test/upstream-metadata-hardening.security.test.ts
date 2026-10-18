import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogDiff, catalogFingerprint } from '../../mcp-upstream/src/fingerprint.js';
import { proxyToolDefinitions, proxyPromptEntries } from '../src/upstream-catalog.js';
import { fakeUpstreams, upstreamService } from './upstream-context.js';

test('review fingerprints include prompt arguments and resource mimeType', () => {
  const base = {
    tools: [],
    resources: [{ uri: 'sample://one', mimeType: 'text/plain' }],
    prompts: [{ name: 'sample', arguments: [{ name: 'input', required: false }] }],
  };
  assert.notEqual(
    catalogFingerprint(base),
    catalogFingerprint({
      ...base,
      prompts: [{ name: 'sample', arguments: [{ name: 'input', required: true }] }],
    }),
  );
  assert.notEqual(
    catalogFingerprint(base),
    catalogFingerprint({ ...base, resources: [{ uri: 'sample://one', mimeType: 'text/html' }] }),
  );
});

test('nested upstream descriptions are bounded, cleaned and marked untrusted', () => {
  const fx = fakeUpstreams({
    catalog: {
      tools: [
        {
          name: 'sample',
          inputSchema: {
            properties: { field: { description: '\u001b[31m' + 'words '.repeat(1000) } },
          },
        },
      ],
      prompts: [
        { name: 'sample', arguments: [{ name: 'input', description: '\u0001external words' }] },
      ],
    },
  });
  const tools: any = proxyToolDefinitions(fx.port);
  const description = tools[0].inputSchema.properties.field.description;
  assert.match(description, /untrusted/i);
  assert.ok(description.length < 1400);
  assert.doesNotMatch(description, /\u001b/);
  assert.match((proxyPromptEntries(fx.port)[0]!.arguments[0] as any).description, /untrusted/i);
});

test('proxied upstream errors carry the untrusted marker', async () => {
  const fx = upstreamService({ toolError: new Error('external instruction words') });
  await assert.rejects(
    () => fx.service.call('s1', 'github__search', {}),
    (error: any) => /untrusted/i.test(error.message),
  );
});

test('catalog canonicalization distinguishes object and array literal values', () => {
  const catalog = (value: unknown) => ({
    tools: [{ name: 'sample', inputSchema: { type: 'object', const: value } }],
    resources: [],
    prompts: [],
  });
  assert.notEqual(
    catalogFingerprint(catalog({ mode: 'read' })),
    catalogFingerprint(catalog([['mode', 'read']])),
  );
  assert.deepEqual(catalogDiff(catalog({ mode: 'read' }), catalog([['mode', 'read']])).changed, [
    'tool:sample',
  ]);
  assert.equal(
    catalogFingerprint(catalog({ a: 1, b: 2 })),
    catalogFingerprint(catalog({ b: 2, a: 1 })),
  );
});

test('schema annotations are sanitized without changing literals, refs, names or constraints', () => {
  const literal = { description: 'required verbatim words', title: 'literal title' };
  const long = 'x'.repeat(2000);
  const fx = fakeUpstreams({
    catalog: {
      tools: [
        {
          name: 'sample',
          inputSchema: {
            type: 'object',
            const: literal,
            enum: [literal],
            default: literal,
            examples: [literal],
            properties: {
              description: { const: literal, description: 'annotation' },
              [long]: { type: 'string' },
            },
            required: [long],
            $ref: '#/$defs/' + long,
          },
        },
      ],
    },
  });
  const schema: any = proxyToolDefinitions(fx.port)[0]!.inputSchema;
  assert.deepEqual(schema.const, literal);
  assert.deepEqual(schema.enum, [literal]);
  assert.deepEqual(schema.default, literal);
  assert.deepEqual(schema.examples, [literal]);
  assert.deepEqual(schema.properties.description.const, literal);
  assert.match(schema.properties.description.description, /untrusted/);
  assert.ok(schema.properties[long]);
  assert.deepEqual(schema.required, [long]);
  assert.equal(schema.$ref, '#/$defs/' + long);
});
