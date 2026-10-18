import { InfoIcon } from '../../components/InfoIcon';
import { Switch } from '../../components/Switch';
import { DetailIcon } from '../workspaces/WorkspaceIcons';
import type { UpstreamSummary } from './McpUpstreamsSettings';

function McpTestIcon() {
  return (
    <svg
      viewBox="0 -0.5 17 17"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="workspace-action-icon"
    >
      <path
        d="M12,1 L12,0.023 L6,0.023 C6,0.023 6,0.013 6,1 L7.012,1 L7.012,7 L3,15 C3,15 3,15.962 4,15.962 L14,15.962 C15,15.962 15,15 15,15 L10.958,7 L10.938,1 L12,1 L12,1 Z M14,15.031 L4,15.031 L8,7 L8,1 L10,1 L10,7 L14,15.031 L14,15.031 Z"
        fill="currentColor"
        className="si-glyph-fill"
      />
    </svg>
  );
}

export function McpUpstreamRowActions({
  row,
  busy,
  onToggle,
  onHints,
  onTest,
  onEdit,
  onRemove,
}: {
  row: UpstreamSummary;
  busy: boolean;
  onHints(): void;
  onToggle(enabled: boolean): void;
  onTest(): void;
  onEdit(): void;
  onRemove(): void;
}) {
  const toggleLabel = `Enable ${row.name}`;
  return (
    <div className="actions workspace-row-actions compact-settings-actions">
      <Switch
        label={<span className="sr-only">{toggleLabel}</span>}
        containerClassName="mcp-upstream-toggle"
        aria-label={toggleLabel}
        title={toggleLabel}
        checked={row.enabled}
        disabled={busy}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      {row.advisory.length > 0 || (row.tools?.length ?? 0) > 0 ? (
        <button
          type="button"
          aria-label={`Detail for ${row.name}`}
          title={`Detail for ${row.name}`}
          aria-haspopup="dialog"
          onClick={onHints}
        >
          <InfoIcon />
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy || !row.enabled}
        aria-label={`Test ${row.name}`}
        title={row.enabled ? `Test ${row.name}` : `Enable ${row.name} to test it`}
        onClick={onTest}
      >
        <McpTestIcon />
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`Edit ${row.name}`}
        title={`Edit ${row.name}`}
        onClick={onEdit}
      >
        <DetailIcon />
      </button>
      <button
        type="button"
        className="danger-button"
        disabled={busy}
        aria-label={`Remove ${row.name}`}
        onClick={onRemove}
      >
        [x]
      </button>
    </div>
  );
}
