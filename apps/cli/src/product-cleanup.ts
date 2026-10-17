import os from 'node:os';
import { purgeStateDirectory } from '../../../packages/agent-integration/src/cleanup.js';
import { releaseExtension } from '../../../packages/agent-integration/src/shared-extension.js';
import { createUserServiceAdapter } from '../../core/src/service/service-manager.js';
import type { CoreConfig } from '../../core/src/config.js';
import { localAdminFetch } from './local-client.js';

export async function cleanupRootProduct(
  config: CoreConfig,
  purge: boolean,
  dryRun: boolean,
  shutdown: () => Promise<unknown>,
) {
  if (dryRun)
    return {
      message: `Would remove root Aevra managed integrations${purge ? ', service and owned application state' : ''}. Package removal uses your package manager.`,
    };
  if (purge) {
    const service = createUserServiceAdapter(process.platform, process.execPath, process.argv[1]!);
    if ((await service.status()) !== 'not-installed') await service.uninstall?.();
    await shutdown().catch(() => undefined);
    let stopped = false;
    for (let i = 0; i < 40; i++) {
      try {
        await localAdminFetch(config, '/api/health');
      } catch (error) {
        if (['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          stopped = true;
          break;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!stopped)
      throw new Error(
        'STATE_PURGE_BUSY: core is still running; stop it and retry uninstall --purge',
      );
    purgeStateDirectory(config.stateDir, 'aevra', os.homedir());
  }
  return {
    extension: releaseExtension(os.homedir(), 'aevra', purge),
    message:
      'Root Aevra integration cleanup finished. Remove the npm package with your package manager if desired.',
  };
}
