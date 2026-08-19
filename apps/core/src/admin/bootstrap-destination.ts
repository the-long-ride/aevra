export type AdminDestination = '/';

export function parseAdminDestination(
  value: string | undefined,
): AdminDestination | null {
  return value === undefined || value === '/' ? '/' : null;
}
