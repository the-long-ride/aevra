import type { DatabaseSync } from 'node:sqlite';
import type { ConnectorProfile } from '../../../../packages/mcp-tools/src/tool-groups.js';
import { ConnectorNotesRepository } from '../../../../packages/store/src/connector-notes.js';
import { TokenUsageRepository } from '../../../../packages/store/src/token-usage.js';
import { ConnectorNotesService } from './connector-notes.js';
import { ConnectorProfileStore, type ProfileSettings } from './connector-profiles.js';
import { UsageMeter } from './usage-meter.js';

/**
 * Everything per-connector (token usage, tool surface, notes), built once so
 * `runtime.ts` only has to forward a few fields.
 */
export function createRuntimeUsage(raw: DatabaseSync, settings: ProfileSettings) {
  const meter = new UsageMeter(new TokenUsageRepository(raw));
  const profiles = new ConnectorProfileStore(settings);
  const notes = new ConnectorNotesService(new ConnectorNotesRepository(raw));
  meter.start();
  return {
    meter,
    profiles,
    notes,
    admin: { usage: meter, connectorProfiles: profiles, connectorNotes: notes },
    mcp: {
      usage: meter,
      connectorProfile: (actor: string): ConnectorProfile | undefined => profiles.get(actor),
      connectNotice: (actor: string): string | null => notes.connectNotice(actor),
    },
    tools: { connectorNotes: notes },
    close: () => meter.close(),
  };
}
