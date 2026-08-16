import { loadCoreConfig } from './config.js';
import { createCoreRuntime } from './runtime.js';
const runtime = await createCoreRuntime(loadCoreConfig());
await runtime.start();
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.once(sig, () => void runtime.close().finally(() => process.exit(0)));
