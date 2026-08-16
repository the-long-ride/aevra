import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const MAX_USERNAME_BYTES = 256;
const MAX_PASSWORD_BYTES = 4096;
const KEY_BYTES = 32;

function credentialsError(): Error {
  const error = new Error(
    'ADMIN_CREDENTIALS_REQUIRED: AEVRA_USERNAME and AEVRA_PASSWORD must both be configured',
  );
  (error as Error & { code?: string }).code = 'ADMIN_CREDENTIALS_REQUIRED';
  return error;
}

export function loadAdminCredentials(env: NodeJS.ProcessEnv = process.env): {
  username: string;
  password: string;
} {
  const username = env.AEVRA_USERNAME;
  const password = env.AEVRA_PASSWORD;
  if (!username || !username.trim() || password === undefined || password.length === 0) {
    throw credentialsError();
  }
  if (
    Buffer.byteLength(username) > MAX_USERNAME_BYTES ||
    Buffer.byteLength(password) > MAX_PASSWORD_BYTES
  ) {
    throw credentialsError();
  }
  return { username, password };
}

async function derive(value: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(value, salt, KEY_BYTES)) as Buffer;
}

export class AdminCredentialVerifier {
  private constructor(
    private readonly usernameDigest: Buffer,
    private readonly passwordDigest: Buffer,
    private readonly usernameSalt: Buffer,
    private readonly passwordSalt: Buffer,
  ) {}

  static async create(username: string, password: string): Promise<AdminCredentialVerifier> {
    const usernameSalt = randomBytes(16);
    const passwordSalt = randomBytes(16);
    const [usernameDigest, passwordDigest] = await Promise.all([
      derive(username, usernameSalt),
      derive(password, passwordSalt),
    ]);
    return new AdminCredentialVerifier(usernameDigest, passwordDigest, usernameSalt, passwordSalt);
  }

  async verify(username: string, password: string): Promise<boolean> {
    if (
      Buffer.byteLength(username) > MAX_USERNAME_BYTES ||
      Buffer.byteLength(password) > MAX_PASSWORD_BYTES
    ) {
      return false;
    }
    const [usernameDigest, passwordDigest] = await Promise.all([
      derive(username, this.usernameSalt),
      derive(password, this.passwordSalt),
    ]);
    return (
      timingSafeEqual(usernameDigest, this.usernameDigest) &&
      timingSafeEqual(passwordDigest, this.passwordDigest)
    );
  }
}
