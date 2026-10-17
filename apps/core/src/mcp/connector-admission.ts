import { IpRateLimiter } from './rate-limit.js';
interface ConnectorRow {
  id: string;
  name: string;
}

interface ConnectorRepositoryLike {
  findByToken(token: string): ConnectorRow | null;
  recordUse(id: string): void;
}

interface RateLimiterLike {
  allow(ip: string): boolean;
  recordFailure(ip: string): void;
}

export function createConnectorAdmission(
  connectors: ConnectorRepositoryLike,
  limiter: RateLimiterLike,
  admittedLimiter: Pick<RateLimiterLike, 'allow'> = new IpRateLimiter(60, 10),
) {
  return {
    lookup: (token: string) => Boolean(connectors.findByToken(token)),
    verify: async (token: string, ip: string) => {
      const row = connectors.findByToken(token);
      if (!row) {
        if (!limiter.allow(ip)) return { kind: 'rate-limited' } as const;
        limiter.recordFailure(ip);
        return { kind: 'denied' } as const;
      }
      if (admittedLimiter && !admittedLimiter.allow(row.id))
        return { kind: 'rate-limited' } as const;
      connectors.recordUse(row.id);
      return {
        kind: 'admitted',
        identity: {
          actor: `connector:${row.name}`,
          subject: row.id,
          issuer: 'aevra:connector',
          audience: 'aevra',
          expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        },
      } as const;
    },
  };
}
