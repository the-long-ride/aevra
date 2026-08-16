import { loadCoreConfig } from './config.js';
import { createCoreRuntime } from './runtime.js';

try {
  const runtime = await createCoreRuntime(loadCoreConfig());
  await runtime.start();
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.once(sig, () => void runtime.close().finally(() => process.exit(0)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[aevra] ${message}`);
  process.exitCode = 1;
}
