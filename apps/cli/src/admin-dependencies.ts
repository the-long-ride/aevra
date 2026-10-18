import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAdminCredentials } from '../../core/src/admin/admin-credentials.js';
import type { CoreConfig } from '../../core/src/config.js';
import type { AdminSessionDependencies } from './admin-session.js';
import { localAdminBase, localAdminFetch } from './local-client.js';

export function adminDependencies(config: CoreConfig): AdminSessionDependencies<CoreConfig> {
  return {
    async controlSecret() {
      return readFileSync(path.join(config.stateDir, 'local-control.secret'), 'utf8').trim();
    },
    async credentials() {
      return loadAdminCredentials(process.env);
    },
    base: (current) => localAdminBase(current),
    fetch: (current, apiPath, init) => localAdminFetch(current, apiPath, init),
  };
}
