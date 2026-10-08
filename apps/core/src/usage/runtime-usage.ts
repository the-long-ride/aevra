import type { DatabaseSync } from 'node:sqlite';
import type { ConnectorProfile } from '../../../../packages/mcp-tools/src/tool-groups.js';
import { TokenUsageRepository } from '../../../../packages/store/src/token-usage.js';
import { ConnectorProfileStore, type ProfileSettings } from './connector-profiles.js';
import { UsageMeter } from './usage-meter.js';

/** Everything token-usage related, built once so `runtime.ts` only has to forward a few fields. */
export function createRuntimeUsage(raw: DatabaseSync, settings: ProfileSettings) {
  const meter = new UsageMeter(new TokenUsageRepository(raw));
  const profiles = new ConnectorProfileStore(settings);
  meter.start();
  return {
    meter,
    profiles,
    admin: { usage: meter, connectorProfiles: profiles },
    mcp: {
      usage: meter,
      connectorProfile: (actor: string): ConnectorProfile | undefined => profiles.get(actor),
    },
    close: () => meter.close(),
  };
}
