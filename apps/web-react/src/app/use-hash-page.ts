import type { AdminPageId } from '@aevra/admin-contracts';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { commitAdminNavigation, pageTokenFromHash } from './hash-navigation';

const validPages = new Set<AdminPageId>(
  ADMIN_SURFACE.navigation.map((item) => item.id),
);

function pageFromHash(): AdminPageId {
  const candidate = pageTokenFromHash(window.location.hash);
  return validPages.has(candidate as AdminPageId)
    ? (candidate as AdminPageId)
    : 'dashboard';
}

export function useHashPage() {
  const [page, setPage] = useState<AdminPageId>(pageFromHash);

  useEffect(() => {
    const onPopState = () => setPage(pageFromHash());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (next: AdminPageId) => {
    commitAdminNavigation(
      next,
      window.location.hash,
      setPage,
      (hash) => window.history.pushState(null, '', hash),
    );
  };

  return { page, navigate };
}
