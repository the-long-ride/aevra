import type { UpstreamCatalog } from '../../../packages/mcp-upstream/src/protocol.js';
import type { UpstreamTransportConfig } from '../../../packages/mcp-upstream/src/transport.js';
import type { SecretStore } from '../../../packages/secrets/src/store.js';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import {
  UpstreamRegistryService,
  type UpstreamRegisterInput,
} from '../src/mcp-upstream/upstream-registry-service.js';
import { UpstreamRepository } from '../src/mcp-upstream/upstream-repository.js';

export const vault: SecretStore = {
  set: async () => {},
  get: async (ref: string) => (ref === 'sr_1' ? 'sk-live-4f2c9d81aa3e' : null),
  delete: async () => {},
};

export function catalogWith(description: string): UpstreamCatalog {
  return {
    tools: [{ name: 'echo', description, inputSchema: { type: 'object' } }],
    resources: [],
    prompts: [],
  };
}

export function harness() {
  const db = AevraDatabase.open(':memory:');
  const calls: string[] = [];
  let catalog = catalogWith('Echoes text');
  let failure: Error | null = null;
  let nextFailure: Error | null = null;
  let connectedConfig: UpstreamTransportConfig | null = null;
  let listChangedAt: string | null = null;
  let catalogStarted: (() => void) | null = null;
  let catalogGate: Promise<void> | null = null;
  let forwarded = 0;
  const service = new UpstreamRegistryService({
    repository: new UpstreamRepository(db.raw()),
    secrets: vault,
    worker: {
      connect: async (upstreamId, config) => {
        calls.push(`connect:${upstreamId}`);
        if (nextFailure) {
          const error = nextFailure;
          nextFailure = null;
          throw error;
        }
        if (failure) throw failure;
        connectedConfig = config;
      },
      catalog: async (upstreamId) => {
        calls.push(`catalog:${upstreamId}`);
        catalogStarted?.();
        catalogStarted = null;
        if (catalogGate) await catalogGate;
        return catalog;
      },
      disconnect: async (upstreamId) => {
        calls.push(`disconnect:${upstreamId}`);
        connectedConfig = null;
      },
      status: async () => ({
        upstreamId: 'mu_test',
        state: connectedConfig ? 'connected' : 'idle',
        server: null,
        failures: 0,
        retryAfter: null,
        lastError: null,
        listChangedAt,
      }),
      call: async () => {
        forwarded += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
    now: () => new Date('2026-09-15T00:00:00.000Z'),
  });
  return {
    db,
    service,
    calls,
    setCatalog: (next: UpstreamCatalog) => {
      catalog = next;
    },
    setFailure: (next: Error | null) => {
      failure = next;
    },
    setNextFailure: (next: Error) => {
      nextFailure = next;
    },
    connectedConfig: () => connectedConfig,
    setListChangedAt: (value: string | null) => {
      listChangedAt = value;
    },
    pauseNextCatalog: () => {
      const started = new Promise<void>((resolve) => {
        catalogStarted = resolve;
      });
      let release!: () => void;
      catalogGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { started, release: () => release() };
    },
    forwarded: () => forwarded,
  };
}

export const input: UpstreamRegisterInput = {
  name: 'github',
  transport: 'http',
  config: { url: 'https://a.test/mcp' },
  auth: { header: 'Authorization', secretRefId: 'sr_1' },
  risk: 'HIGH',
};
