import {
  RESULT_FORMATS,
  TOOL_GROUPS,
  type ConnectorProfile,
  type ResultFormat,
  type ToolGroup,
} from '../../../../packages/mcp-tools/src/tool-groups.js';

const SETTINGS_KEY = 'mcp.connectorProfiles';
const MAX_ACTOR_LENGTH = 200;

/** The slice of SettingsRepository this store needs. */
export interface ProfileSettings {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_CONNECTOR_PROFILE' });
}

/** Validates and normalises: defaults are omitted so an unrestricted connector stores nothing. */
export function parseConnectorProfile(input: unknown): ConnectorProfile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid('Connector profile must be an object.');
  }
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key !== 'toolGroups' && key !== 'resultFormat') {
      throw invalid(`Unknown profile field: ${key}.`);
    }
  }
  const profile: ConnectorProfile = {};
  if (source.toolGroups !== undefined) {
    if (!Array.isArray(source.toolGroups)) throw invalid('toolGroups must be a list.');
    for (const group of source.toolGroups) {
      if (!(TOOL_GROUPS as readonly unknown[]).includes(group)) {
        throw invalid(`Unknown tool group: ${String(group)}.`);
      }
    }
    const chosen = new Set(source.toolGroups as ToolGroup[]);
    const ordered = TOOL_GROUPS.filter((group) => chosen.has(group));
    if (ordered.length !== TOOL_GROUPS.length) profile.toolGroups = ordered;
  }
  if (source.resultFormat !== undefined) {
    if (!(RESULT_FORMATS as readonly unknown[]).includes(source.resultFormat)) {
      throw invalid('resultFormat must be both, text or structured.');
    }
    if (source.resultFormat !== 'both') profile.resultFormat = source.resultFormat as ResultFormat;
  }
  return profile;
}

function checkActor(actor: unknown): string {
  if (
    typeof actor !== 'string' ||
    !actor ||
    actor.length > MAX_ACTOR_LENGTH ||
    actor === '__proto__' ||
    /[\u0000-\u001f]/.test(actor)
  ) {
    throw invalid('Invalid connector actor.');
  }
  return actor;
}

/** Per-connector tool surface, kept in one settings key and cached after the first read. */
export class ConnectorProfileStore {
  private cache: Map<string, ConnectorProfile> | undefined;

  constructor(private readonly settings: ProfileSettings) {}

  all(): Map<string, ConnectorProfile> {
    return (this.cache ??= this.load());
  }

  get(actor: string): ConnectorProfile | undefined {
    return this.all().get(actor);
  }

  set(actor: string, input: unknown): ConnectorProfile {
    const key = checkActor(actor);
    const profile = parseConnectorProfile(input);
    const next = new Map(this.all());
    if (Object.keys(profile).length) next.set(key, profile);
    else next.delete(key);
    this.settings.set(SETTINGS_KEY, Object.fromEntries(next));
    this.cache = next;
    return profile;
  }

  private load(): Map<string, ConnectorProfile> {
    const map = new Map<string, ConnectorProfile>();
    try {
      const stored = this.settings.get<unknown>(SETTINGS_KEY, {});
      if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return map;
      for (const [actor, value] of Object.entries(stored)) {
        try {
          const profile = parseConnectorProfile(value);
          if (Object.keys(profile).length) map.set(actor, profile);
        } catch {
          // Ignore one bad entry; keep the rest.
        }
      }
    } catch {
      // Corrupt settings read as no profiles; the next save rewrites the key.
    }
    return map;
  }
}
