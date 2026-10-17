import { useState } from 'react';
import { McpUpstreamToolDetails } from './McpUpstreamToolDetails';
import { ManagementModal } from '../../components/ManagementModal';
import type { UpstreamState, UpstreamSummary } from './McpUpstreamsSettings';

const upstreamStateLabels: Record<UpstreamState, string> = {
  active: 'Active',
  degraded: 'Degraded',
  'needs-review': 'Needs review',
};

export function upstreamStatusLabel(row: UpstreamSummary): string {
  return row.enabled ? (upstreamStateLabels[row.state] ?? row.state) : 'Disabled';
}

export function McpUpstreamStatus({ row }: { row: UpstreamSummary }) {
  const label = upstreamStatusLabel(row);
  const tone = !row.enabled
    ? 'mcp-upstream-disabled-badge'
    : row.state === 'active'
      ? 'success'
      : 'warning';
  return <span className={`status mcp-upstream-status ${tone}`}>{label}</span>;
}

export function McpUpstreamHintsModal({ row, onClose }: { row: UpstreamSummary; onClose(): void }) {
  const [search, setSearch] = useState('');
  const tools = row.tools?.length
    ? row.tools
    : row.advisory.map(({ tool, ...annotations }) => ({ name: tool, annotations }));
  const query = search.trim().toLowerCase();
  const visibleTools = tools.filter((tool) =>
    `${tool.name} ${'description' in tool ? (tool.description ?? '') : ''}`
      .toLowerCase()
      .includes(query),
  );
  return (
    <ManagementModal open title={`Detail — ${row.name}`} onClose={onClose}>
      <div className="mcp-upstream-hints-content">
        <p className="section-note">
          Server-provided hints are advisory only. Shown for context; it does not affect the risk
          tier.
        </p>
        <p>
          Configured risk: <span className="risk">{row.risk}</span>
        </p>
        {row.documentationSource === 'pending' ? (
          <p className="warning-text">
            Pending catalog — these tool instructions have not been acknowledged. Viewing them does
            not accept the catalog change.
          </p>
        ) : null}
        <label className="mcp-upstream-tool-search">
          Search tools
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tool names or instructions…"
          />
        </label>
        <p className="section-note">
          {visibleTools.length} of {tools.length} tools
        </p>
        {tools.length === 0 ? (
          <p className="section-note">No tool documentation has been recorded yet.</p>
        ) : visibleTools.length === 0 ? (
          <p className="section-note">No tools match your search.</p>
        ) : (
          <ul className="mcp-upstream-hints">
            {visibleTools.map((tool) => (
              <li key={tool.name}>
                <McpUpstreamToolDetails tool={tool} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ManagementModal>
  );
}
