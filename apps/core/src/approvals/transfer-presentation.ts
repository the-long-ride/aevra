import { redactText } from '../../../../packages/security/src/dlp.js';
import { stripControlCharacters } from '../../../../packages/security/src/untrusted.js';
import type { ApprovalPresentation } from './request-presentation.js';

const PREVIEW_MAX = 4000;

function line(value: unknown, max: number) {
  const text = redactText(
    stripControlCharacters(String(value ?? ''))
      .replace(/\s+/g, ' ')
      .trim(),
  ).text;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function size(bytes: unknown) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'size unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Card for a files_download / files_upload batch. Only the frozen summary is shown:
 * path, source (inline or host) and size per entry, never content, headers or URL queries.
 */
export function presentTransfer(
  ticket: { workspaceId?: string },
  transfer: any,
): ApprovalPresentation {
  const entries: any[] = Array.isArray(transfer?.entries) ? transfer.entries : [];
  const upload = transfer?.direction === 'upload';
  const lines = entries.map(
    (entry) =>
      `${line(entry.path, 200)}  ${entry.source === 'url' ? line(entry.host, 120) : 'inline'}  ${size(entry.bytes)}`,
  );
  const hosts = [
    ...new Set(entries.filter((e) => e.source === 'url' && e.host).map((e) => line(e.host, 120))),
  ];
  const extra = [
    hosts.length ? `network: ${hosts.join(', ')}` : '',
    Number(transfer?.headersSupplied) > 0
      ? `headers: ${Number(transfer.headersSupplied)} supplied`
      : '',
  ].filter(Boolean);
  const full = [...lines, ...extra].join('\n');
  const count = `${entries.length} file${entries.length === 1 ? '' : 's'}`;
  return {
    title: 'File transfer',
    action: upload ? `Send ${count} to the agent` : `Receive ${count} from the agent`,
    target: `Workspace ${line(ticket.workspaceId, 120)}`,
    preview: full.length > PREVIEW_MAX ? full.slice(0, PREVIEW_MAX) : full,
    ...(full.length > PREVIEW_MAX ? { truncated: true, previewFullLength: full.length } : {}),
  };
}
