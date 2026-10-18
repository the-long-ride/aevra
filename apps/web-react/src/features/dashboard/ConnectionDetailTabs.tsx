import type { ReactNode } from 'react';

export type ConnectionTab = 'details' | 'notes';

const LABELS: Record<ConnectionTab, string> = { details: 'Details', notes: 'Notes' };

function tabLabel(tab: ConnectionTab, count: number | undefined): string {
  return count ? `${LABELS[tab]} (${count})` : LABELS[tab];
}

export function ConnectionDetailTabs({
  tabs,
  selected,
  counts,
  onSelect,
}: {
  tabs: readonly ConnectionTab[];
  selected: ConnectionTab;
  /** Item count shown after a tab's label, e.g. `Notes (11)`; hidden when 0 or missing. */
  counts?: Partial<Record<ConnectionTab, number>>;
  onSelect(tab: ConnectionTab): void;
}) {
  const move = (from: ConnectionTab, step: number) => {
    const next = tabs[(tabs.indexOf(from) + step + tabs.length) % tabs.length]!;
    onSelect(next);
    document.getElementById(`connection-tab-${next}`)?.focus();
  };
  return (
    <div className="request-tabs connection-tabs" role="tablist" aria-label="Connection sections">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`connection-tab-${tab}`}
          aria-selected={selected === tab}
          aria-controls={selected === tab ? `connection-panel-${tab}` : undefined}
          tabIndex={selected === tab ? 0 : -1}
          className={selected === tab ? 'active' : ''}
          data-surface-id={tab === 'notes' ? 'connections:notes-tab' : undefined}
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(tab, 1);
            if (event.key === 'ArrowLeft') move(tab, -1);
          }}
        >
          {tabLabel(tab, counts?.[tab])}
        </button>
      ))}
    </div>
  );
}

export function ConnectionTabPanel({ tab, children }: { tab: ConnectionTab; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`connection-panel-${tab}`}
      aria-labelledby={`connection-tab-${tab}`}
      className="connection-tab-panel"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
