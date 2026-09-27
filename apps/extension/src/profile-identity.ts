const PROFILE_ID_KEY = 'profileId';
const PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BrowserProfileIdentity {
  profileId: string;
  profileName: string;
}

/** A stable identity for this extension installation in this browser profile. */
export async function getBrowserProfileIdentity(): Promise<BrowserProfileIdentity> {
  const stored = await chrome.storage.local.get([PROFILE_ID_KEY, 'profileName']);
  let profileId =
    typeof stored[PROFILE_ID_KEY] === 'string' ? (stored[PROFILE_ID_KEY] as string) : '';
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    profileId = crypto.randomUUID();
    await chrome.storage.local.set({ [PROFILE_ID_KEY]: profileId });
  }
  return {
    profileId: profileId.toLowerCase(),
    profileName:
      typeof stored.profileName === 'string' ? stored.profileName.trim().slice(0, 120) : '',
  };
}
