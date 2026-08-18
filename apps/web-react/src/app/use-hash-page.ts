import type { AdminPageId } from '@aevra/admin-contracts';
import { ADMIN_SURFACE } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';

const validPages = new Set<AdminPageId>(
  ADMIN_SURFACE.navigation.map((item) => item.id),
);

function pageFromHash(): AdminPageId {
  const candidate = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return validPages.has(candidate as AdminPageId)
    ? (candidate as AdminPageId)
    : 'dashboard';
}

export function useHashPage() {
  const [page, setPage] = useState<AdminPageId>(pageFromHash);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: AdminPageId) => {
    if (next === page) return;
    window.history.replaceState(null, '', `#/${next}`);
    setPage(next);
  };
  return { page, navigate };
}
