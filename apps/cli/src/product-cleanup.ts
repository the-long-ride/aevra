import os from 'node:os';
import { prepareStatePurge } from '../../../packages/agent-integration/src/cleanup.js';
import {
  releaseExtension,
  releaseExtensionOrKeep,
} from '../../../packages/agent-integration/src/shared-extension.js';
import { createUserServiceAdapter } from '../../core/src/service/service-manager.js';
import type { CoreConfig } from '../../core/src/config.js';
import { localAdminFetch } from './local-client.js';

function finished(retained: string[]): string {
  const kept = retained.length
    ? ` Kept in the state directory (not created by Aevra, or still used): ${retained.join(', ')}.`
    : '';
  return `Root Aevra integration cleanup finished.${kept} Remove the npm package with your package manager if desired.`;
}

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
    // Ownership is checked before the service is stopped, so a refusal changes nothing.
    const statePurge = prepareStatePurge(config.stateDir, 'aevra', os.homedir());
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
    // Release the extension first: a copy another product still owns stays, even inside stateDir.
    // The service is already stopped: an extension that cannot be released is kept, not fatal.
    const extension = releaseExtensionOrKeep(os.homedir(), 'aevra', true);
    const state = statePurge.run(extension.retained ? [extension.retained] : []);
    return { extension, state, message: finished(state.retained) };
  }
  return { extension: releaseExtension(os.homedir(), 'aevra', false), message: finished([]) };
}
