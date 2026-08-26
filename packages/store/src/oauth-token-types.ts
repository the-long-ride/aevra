import type { OAuthRefreshTokenRecord } from './oauth-records.js';

export type RefreshRotationResult =
  | { status: 'ROTATED'; previous: OAuthRefreshTokenRecord; nextToken: string }
  | { status: 'INVALID' }
  | { status: 'REPLAYED' };
