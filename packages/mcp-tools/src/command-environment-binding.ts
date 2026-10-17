import { createHash } from 'node:crypto';

/** Environment names are case-insensitive only on Windows. */
export function explicitEnvironmentFingerprint(
  environment: Record<string, string>,
  platform: string,
): string {
  const entries = Object.entries(environment)
    .map(([key, value]) => [platform === 'win32' ? key.toUpperCase() : key, value])
    .sort(([a], [b]) => a!.localeCompare(b!));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
