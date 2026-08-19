import path from 'node:path';

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function resolveStaticAsset(
  staticRoot: string,
  pathname: string,
): string | null {
  const decoded = decodePathname(pathname);
  if (!decoded || !decoded.startsWith('/') || decoded.includes('\\')) {
    return null;
  }

  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const root = path.resolve(staticRoot);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return candidate;
}
