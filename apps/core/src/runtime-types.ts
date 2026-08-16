import type { CoreConfig } from './config.js';
import type { AevraDatabase } from '../../../packages/store/src/database.js';
import type { WorkerClient } from '../../../packages/ipc/src/client.js';
import type { CloudflareManager } from './cloudflare/manager.js';
import type { LocalTlsMaterial } from './tls/local-tls.js';

export interface CoreRuntime {
  readonly adminUrl: string;
  readonly mcpUrl: string;
  readonly gatewayUrl: string;
  readonly publicUrl: string | undefined;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeDependencies {
  worker?: {
    start(): Promise<WorkerClient>;
    close(): Promise<void>;
    execute?: (input: any) => Promise<any>;
  };
  databaseOpen?: (path: string) => AevraDatabase;
  tls?: LocalTlsMaterial;
  ensureTls?: (config: CoreConfig) => Promise<LocalTlsMaterial>;
  cloudflare?: CloudflareManager;
}
