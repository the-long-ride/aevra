import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { SecretStore } from './store.js';
interface VaultFile {
  version: 1;
  salt: string;
  records: Record<string, { iv: string; tag: string; data: string }>;
}
export class EncryptedVault implements SecretStore {
  private key?: Buffer;
  private file: VaultFile;
  constructor(private filePath: string) {
    this.file = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8'))
      : { version: 1, salt: randomBytes(16).toString('base64url'), records: {} };
  }
  unlock(passphrase: string) {
    this.lock();
    this.key = scryptSync(passphrase, Buffer.from(this.file.salt, 'base64url'), 32);
  }
  lock() {
    this.key?.fill(0);
    this.key = undefined;
  }
  isLocked() {
    return !this.key;
  }
  private requireKey() {
    if (!this.key) throw Object.assign(new Error('VAULT_LOCKED'), { code: 'VAULT_LOCKED' });
    return this.key;
  }
  async set(ref: string, value: string) {
    const key = this.requireKey(),
      iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
    this.file.records[ref] = {
      iv: iv.toString('base64url'),
      tag: c.getAuthTag().toString('base64url'),
      data: data.toString('base64url'),
    };
    this.save();
  }
  async get(ref: string) {
    const key = this.requireKey();
    const r = this.file.records[ref];
    if (!r) return null;
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(r.iv, 'base64url'));
    d.setAuthTag(Buffer.from(r.tag, 'base64url'));
    try {
      return Buffer.concat([d.update(Buffer.from(r.data, 'base64url')), d.final()]).toString(
        'utf8',
      );
    } catch {
      throw new Error('Vault authentication failed');
    }
  }
  async delete(ref: string) {
    this.requireKey();
    delete this.file.records[ref];
    this.save();
  }
  private save() {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, JSON.stringify(this.file), { mode: 0o600 });
  }
}
