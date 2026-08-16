import { useEffect, useState } from 'react';

export function DashboardSection({
  id,
  title,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <details
      className="dashboard-section"
      data-dashboard-section={id}
      data-surface-id={`dashboard:${id}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="dashboard-section-summary">
        <span>{title}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="dashboard-section-body">{children}</div>
    </details>
  );
}
