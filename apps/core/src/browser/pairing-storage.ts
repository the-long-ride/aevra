const EXTENSION_ID = /^[a-p]{32}$/;
export const PROFILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SETTINGS_KEY = 'browser.pairing';

export interface StoredPairing {
  pairingId: string;
  profileId: string | null;
  profileName: string;
  extensionId: string;
  pairedAt: string;
  credentialId: string | null;
  legacy: boolean;
}

export interface StoredRegistry {
  epoch: number;
  pairings: StoredPairing[];
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID.test(value);
}

export function fallbackProfileName(profileId: string | null): string {
  return profileId ? `Browser profile ${profileId.slice(0, 8)}` : 'Legacy browser profile';
}

export function normalizeStoredPairing(value: unknown): StoredRegistry {
  const source = asObject(value) ?? {};
  const epoch =
    Number.isSafeInteger(source.epoch) && Number(source.epoch) > 0 ? Number(source.epoch) : 1;

  if (Array.isArray(source.pairings)) {
    const pairings: StoredPairing[] = [];
    for (const raw of source.pairings) {
      const item = asObject(raw);
      if (!item || !validExtensionId(item.extensionId)) continue;
      const legacy = item.legacy === true;
      const profileId =
        typeof item.profileId === 'string' && PROFILE_ID.test(item.profileId)
          ? item.profileId
          : null;
      const credentialId =
        typeof item.credentialId === 'string' && item.credentialId.length > 0
          ? item.credentialId
          : null;
      if ((!legacy && (!profileId || !credentialId)) || (legacy && (profileId || credentialId))) {
        continue;
      }
      const pairingId =
        typeof item.pairingId === 'string' && item.pairingId.length > 0
          ? item.pairingId
          : legacy
            ? `legacy-${item.extensionId}`
            : profileId!;
      const pairedAt =
        typeof item.pairedAt === 'string' && Number.isFinite(Date.parse(item.pairedAt))
          ? item.pairedAt
          : new Date(0).toISOString();
      const profileName =
        typeof item.profileName === 'string' && item.profileName.trim()
          ? item.profileName.trim().slice(0, 120)
          : fallbackProfileName(profileId);
      pairings.push({
        pairingId,
        profileId,
        profileName,
        extensionId: item.extensionId,
        credentialId,
        pairedAt,
        legacy,
      });
    }
    return { epoch, pairings };
  }

  if (validExtensionId(source.extensionId)) {
    const pairedAt =
      typeof source.pairedAt === 'string' && Number.isFinite(Date.parse(source.pairedAt))
        ? source.pairedAt
        : new Date(0).toISOString();
    return {
      epoch,
      pairings: [
        {
          pairingId: `legacy-${source.extensionId}`,
          profileId: null,
          profileName: fallbackProfileName(null),
          extensionId: source.extensionId,
          credentialId: null,
          pairedAt,
          legacy: true,
        },
      ],
    };
  }
  return { epoch, pairings: [] };
}
