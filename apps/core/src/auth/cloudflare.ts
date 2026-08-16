import type { IncomingMessage } from 'node:http';
import {
  createPublicKey,
  verify as cryptoVerify,
  type JsonWebKey as CryptoJsonWebKey,
} from 'node:crypto';
export interface VerifiedRemoteIdentity {
  subject: string;
  actor: string;
  issuer: string;
  audience: string;
  expiresAt: string;
}
export interface RemoteIdentityVerifier {
  verifyRequest(request: IncomingMessage): Promise<VerifiedRemoteIdentity>;
}
export interface JwksProvider {
  get(issuer: string): Promise<{ keys: CryptoJsonWebKey[] }>;
}
function b64json(value: string) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, any>;
}
function tokenFrom(req: IncomingMessage) {
  const direct = req.headers['cf-access-jwt-assertion'];
  if (typeof direct === 'string') return direct;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  throw new Error('missing Cloudflare Access JWT');
}
class RemoteJwks implements JwksProvider {
  private cache = new Map<string, { at: number; keys: CryptoJsonWebKey[] }>();
  async get(issuer: string) {
    const hit = this.cache.get(issuer);
    if (hit && Date.now() - hit.at < 5 * 60_000) return { keys: hit.keys };
    const url = new URL('/cdn-cgi/access/certs', issuer).toString();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`JWKS ${r.status}`);
    const body = (await r.json()) as { keys: CryptoJsonWebKey[] };
    this.cache.set(issuer, { at: Date.now(), keys: body.keys });
    return body;
  }
}
export class CloudflareAccessVerifier implements RemoteIdentityVerifier {
  constructor(
    private issuer: string,
    private audience: string,
    private jwks: JwksProvider = new RemoteJwks(),
  ) {}
  async verifyRequest(request: IncomingMessage): Promise<VerifiedRemoteIdentity> {
    const token = tokenFrom(request);
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid JWT');
    const header = b64json(parts[0]!),
      claims = b64json(parts[1]!);
    if (header.alg !== 'RS256') throw new Error('unsupported JWT algorithm');
    if (claims.iss !== this.issuer) throw new Error('wrong JWT issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.audience)) throw new Error('wrong JWT audience');
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('expired JWT');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('missing subject');
    const actor = claims.email ?? claims.preferred_username ?? claims.sub;
    if (typeof actor !== 'string' || !actor) throw new Error('missing actor claim');
    const { keys } = await this.jwks.get(this.issuer);
    const jwk = keys.find((k: any) => k.kid === header.kid);
    if (!jwk) throw new Error('unknown JWT key');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const ok = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2]!, 'base64url'),
    );
    if (!ok) throw new Error('invalid JWT signature');
    return {
      subject: claims.sub,
      actor,
      issuer: this.issuer,
      audience: this.audience,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }
}
export class RejectingIdentityVerifier implements RemoteIdentityVerifier {
  async verifyRequest(_request: IncomingMessage): Promise<VerifiedRemoteIdentity> {
    throw new Error('Cloudflare Access is not configured');
  }
}
