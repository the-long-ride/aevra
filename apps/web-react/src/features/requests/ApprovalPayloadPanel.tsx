import { CommandList } from '../../components/CommandCallView';
import { JsonDetailView } from '../../components/JsonDetailView';
import { DetailModeToggle, useDetailMode } from '../../components/ToolCallView';
import { extractCommands, type CommandCall } from '../../components/tool-call-format';

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The command analysis already renders in the decision column; keep it out of the tree. */
function visiblePayload(payload: Payload): Payload {
  const { commandAnalysis: _analysis, ...rest } = payload;
  return rest;
}

export function hasApprovalDetails(payload: Payload | undefined): payload is Payload {
  return Boolean(payload) && Object.keys(visiblePayload(payload!)).length > 0;
}

/** Pulls the command lines out of the payload shapes approval tickets carry. */
export function approvalCommands(payload: Payload): CommandCall[] | null {
  const tool =
    typeof payload.sourceTool === 'string'
      ? payload.sourceTool
      : typeof payload.tool === 'string'
        ? payload.tool
        : undefined;
  const original = isRecord(payload.original) ? payload.original : undefined;
  const candidates: Array<() => CommandCall[] | null> = [
    () => (tool ? extractCommands(tool, isRecord(payload.args) ? payload.args : payload) : null),
    () => extractCommands('shell_run', payload),
    () => extractCommands('command_run', payload),
    () =>
      original && typeof original.tool === 'string'
        ? extractCommands(original.tool, original.args)
        : null,
  ];
  for (const candidate of candidates) {
    const commands = candidate();
    if (commands) return commands;
  }
  return null;
}

export function ApprovalPayloadPanel({ payload }: { payload: Payload }) {
  const [mode, setMode] = useDetailMode();
  const raw = JSON.stringify(payload, null, 2);
  const commands = mode === 'pretty' ? approvalCommands(payload) : null;

  return (
    <aside className="approval-modal-details" aria-label="Request details">
      <div className="approval-modal-details-head">
        <b>Request details</b>
        <DetailModeToggle mode={mode} onChange={setMode} />
      </div>
      {commands ? <CommandList commands={commands} /> : null}
      {commands ? <span className="approval-modal-details-label">Full payload</span> : null}
      {mode === 'raw' ? (
        <JsonDetailView label="Request" value={raw} format="raw" emptyText="No payload." />
      ) : (
        <JsonDetailView
          label="Request"
          value={JSON.stringify(visiblePayload(payload), null, 2)}
          copyValue={raw}
          emptyText="No payload."
        />
      )}
    </aside>
  );
}
