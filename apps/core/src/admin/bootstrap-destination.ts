export type AdminDestination = '/' | '/react/';

export function parseAdminDestination(
  value: string | undefined,
): AdminDestination | null {
  if (value === undefined || value === '/') return '/';
  if (value === '/react' || value === '/react/') return '/react/';
  return null;
}
