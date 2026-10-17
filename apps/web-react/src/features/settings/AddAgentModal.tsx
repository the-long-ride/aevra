import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useRef, useState, type Ref } from 'react';
import { ManagementModal } from '../../components/ManagementModal';
import { AgentChecklist, ScopeFields, TransportField } from './AddAgentFields';
import {
  installAgents,
  type AgentInstallResponse,
  type AgentScope,
  type AgentTargetResult,
  type AgentTransport,
  type DetectedAgent,
} from './agent-service';

const ELLIPSIS = '\u2026';
type Step = 'form' | 'preview' | 'done';
const ACTION = { create: 'Create', update: 'Update', remove: 'Remove' } as const;

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function OutcomeList({ results }: { results: AgentTargetResult[] }) {
  const failed = results.filter((item) => !item.ok);
  return (
    <>
      <div role="status" aria-label="Install results">
        <ul className="agent-modal-results">
          {results.map((item) => (
            <li key={item.target}>
              {item.ok
                ? `${item.target}: Installed`
                : `${item.target}: Failed: ${item.error ?? 'Unknown error'}`}
            </li>
          ))}
        </ul>
      </div>
      {failed.length > 0 && (
        <p role="alert">
          {failed.length} of {results.length} failed. The others stay installed; fix the problem and
          retry the failed agents.
        </p>
      )}
    </>
  );
}

function PreviewPanel({
  preview,
  headingRef,
}: {
  preview: AgentInstallResponse;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const failed = preview.results.filter((item) => !item.ok);
  return (
    <section aria-labelledby="agent-preview-title" aria-live="polite">
      <h3 id="agent-preview-title" ref={headingRef} tabIndex={-1}>
        Preview
      </h3>
      {preview.changes.length ? (
        <ul>
          {preview.changes.map((change) => (
            <li key={`${change.target}|${change.file}|${change.action}`}>
              {ACTION[change.action]} {change.file} ({change.target})
            </li>
          ))}
        </ul>
      ) : (
        <p>No files would change.</p>
      )}
      {preview.notes.length > 0 && (
        <ul aria-label="Notes">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <ul aria-label="Problems">
          {failed.map((item) => (
            <li key={item.target}>{`${item.target}: ${item.error ?? 'Unknown error'}`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AddAgentModal({
  detected,
  detectStatus = 'ready',
  detectError = '',
  workspaces,
  workspaceError = '',
  onClose,
  onChanged,
}: {
  detected: DetectedAgent[];
  detectStatus?: 'loading' | 'ready' | 'failed';
  detectError?: string;
  workspaces: WorkspaceSummary[];
  workspaceError?: string;
  onClose(): void;
  onChanged(): void;
}) {
  const foundTargets = (list: DetectedAgent[]) =>
    list.filter((agent) => agent.found).map((agent) => agent.target);
  const [selected, setSelected] = useState(() => foundTargets(detected));
  const [forced, setForced] = useState<string[]>([]);
  const [scope, setScope] = useState<AgentScope>('user');
  const [workspaceId, setWorkspaceId] = useState('');
  const [transport, setTransport] = useState<AgentTransport>('stdio');
  const [step, setStep] = useState<Step>('form');
  const [preview, setPreview] = useState<AgentInstallResponse | null>(null);
  const [outcomes, setOutcomes] = useState<AgentTargetResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(0);
  const touched = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Follow late detection results until the user edits the checklist.
  useEffect(() => {
    if (!touched.current) setSelected(foundTargets(detected));
  }, [detected]);
  // After each step change keep keyboard focus inside the dialog, on the step heading.
  useEffect(() => {
    if (view > 0) heading.current?.focus();
  }, [view]);

  const installed = outcomes.filter((item) => item.ok).map((item) => item.target);
  const targets = detected
    .map((agent) => agent.target)
    .filter((target) => selected.includes(target) && !installed.includes(target));
  const ready = targets.length > 0 && (scope === 'user' || workspaceId !== '');
  const toggle = (list: string[], target: string) =>
    list.includes(target) ? list.filter((item) => item !== target) : [...list, target];
  const requestClose = () => {
    if (!busy) onClose();
  };
  const go = (next: Step) => {
    setStep(next);
    setView((value) => value + 1);
  };
  // The Installed lock belongs to one scope, workspace and transport.
  const resetOutcomes = () => setOutcomes([]);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await installAgents({
        targets,
        scope,
        ...(scope === 'workspace' ? { workspaceId } : {}),
        transport,
        ...(dryRun ? { dryRun: true } : {}),
      });
      if (dryRun) {
        setPreview(result);
        go('preview');
        return;
      }
      const merged = [...outcomes.filter((old) => old.ok), ...result.results];
      setOutcomes(merged);
      onChanged();
      go(merged.every((item) => item.ok) ? 'done' : 'form');
    } catch (cause) {
      setError(message(cause));
      setView((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  const previewUsable = !preview?.results.length || preview.results.some((item) => item.ok);
  const detectNote =
    detectStatus === 'loading'
      ? `Detecting agents${ELLIPSIS}`
      : detectStatus === 'failed'
        ? ''
        : detected.length === 0
          ? 'No agents detected'
          : '';
  return (
    <ManagementModal open title="Add connection" onClose={requestClose}>
      {error && <p role="alert">{error}</p>}
      {step === 'form' && (
        <div className="agent-modal-form">
          <h3 ref={heading} tabIndex={-1}>
            Connect your agents
          </h3>
          {outcomes.length > 0 && <OutcomeList results={outcomes} />}
          {detectStatus === 'failed' && (
            <p role="alert">{`Could not detect agents: ${detectError || 'unknown error'}`}</p>
          )}
          {detectNote && <p role="status">{detectNote}</p>}
          {workspaceError && <p role="alert">{`Could not load workspaces: ${workspaceError}`}</p>}
          {detected.length > 0 && (
            <AgentChecklist
              detected={detected}
              selected={selected}
              forced={forced}
              installed={installed}
              disabled={busy}
              onToggle={(target) => {
                touched.current = true;
                setSelected((list) => toggle(list, target));
              }}
              onForce={(target) => {
                touched.current = true;
                setForced((list) => toggle(list, target));
                setSelected((list) =>
                  forced.includes(target)
                    ? list.filter((item) => item !== target)
                    : [...list, target],
                );
              }}
            />
          )}
          <ScopeFields
            scope={scope}
            workspaceId={workspaceId}
            workspaces={workspaces}
            disabled={busy}
            onScope={(next) => {
              setScope(next);
              if (next === 'workspace') setTransport('stdio');
              resetOutcomes();
            }}
            onWorkspace={(id) => {
              setWorkspaceId(id);
              resetOutcomes();
            }}
          />
          <TransportField
            scope={scope}
            transport={transport}
            codexSelected={targets.includes('codex')}
            disabled={busy}
            onTransport={(next) => {
              setTransport(next);
              resetOutcomes();
            }}
          />
          <div className="actions">
            <button type="button" onClick={requestClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={!ready || busy}
              onClick={() => void run(true)}
            >
              {busy ? `Previewing${ELLIPSIS}` : 'Preview'}
            </button>
          </div>
        </div>
      )}
      {step === 'preview' && preview && (
        <div className="agent-modal-form">
          <PreviewPanel preview={preview} headingRef={heading} />
          <div className="actions">
            <button type="button" onClick={() => go('form')} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !previewUsable}
              onClick={() => void run(false)}
            >
              {busy ? `Installing${ELLIPSIS}` : 'Install'}
            </button>
          </div>
        </div>
      )}
      {step === 'done' && (
        <div className="agent-modal-form">
          <h3 ref={heading} tabIndex={-1}>
            Connection results
          </h3>
          <OutcomeList results={outcomes} />
          <p>Restart or refresh each agent so it picks up the new connection.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </ManagementModal>
  );
}
