export function pageTokenFromHash(hash: string): string {
  return hash.replace(/^#\/?/, '').split('/')[0] ?? '';
}

export function commitAdminNavigation<Page extends string>(
  next: Page,
  currentHash: string,
  setPage: (page: Page) => void,
  pushHash: (hash: string) => void,
): void {
  const nextHash = `#/${next}`;
  setPage(next);
  if (currentHash !== nextHash) pushHash(nextHash);
}
