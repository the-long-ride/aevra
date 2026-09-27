import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserProfileIdentity } from './profile-identity';

let stored: Record<string, unknown>;
const writes: Record<string, unknown>[] = [];

beforeEach(() => {
  stored = {};
  writes.length = 0;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (values: Record<string, unknown>) => {
          writes.push(values);
          Object.assign(stored, values);
        },
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

describe('getBrowserProfileIdentity', () => {
  it('reuses a stored id, lower-cased, without rewriting it', async () => {
    stored = { profileId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', profileName: '  Work  ' };
    await expect(getBrowserProfileIdentity()).resolves.toEqual({
      profileId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      profileName: 'Work',
    });
    expect(writes).toEqual([]);
  });

  it('mints and persists a new id when none is stored', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abc');
    await expect(getBrowserProfileIdentity()).resolves.toEqual({
      profileId: '12345678-1234-4234-8234-123456789abc',
      profileName: '',
    });
    expect(writes).toEqual([{ profileId: '12345678-1234-4234-8234-123456789abc' }]);
  });

  it('replaces a stored id that is not a UUID or not a string', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abc');
    for (const profileId of ['not-a-uuid', 42]) {
      stored = { profileId };
      writes.length = 0;
      const identity = await getBrowserProfileIdentity();
      expect(identity.profileId).toBe('12345678-1234-4234-8234-123456789abc');
      expect(writes).toHaveLength(1);
    }
  });

  it('caps the profile name and ignores a non-string name', async () => {
    stored = { profileId: '11111111-1111-4111-8111-111111111111', profileName: 'x'.repeat(200) };
    expect((await getBrowserProfileIdentity()).profileName).toHaveLength(120);
    stored = { profileId: '11111111-1111-4111-8111-111111111111', profileName: 7 };
    expect((await getBrowserProfileIdentity()).profileName).toBe('');
  });
});
