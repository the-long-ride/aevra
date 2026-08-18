export function PageState({
  loading,
  error,
  empty,
  children,
}: {
  loading?: boolean;
  error?: Error | null;
  empty?: string | false;
  children: React.ReactNode;
}) {
  if (loading) return <div className="react-page-state">Loading…</div>;
  if (error) return <div className="react-page-state">{error.message}</div>;
  if (empty) return <div className="react-page-state">{empty}</div>;
  return <>{children}</>;
}
