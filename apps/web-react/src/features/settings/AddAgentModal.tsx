import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useRef, useState } from 'react';
import { ManagementModal } from '../../components/ManagementModal';
import { AgentChecklist, TransportField } from './AddAgentFields';
import { OutcomeList, PreviewPanel } from './AddAgentResults';
import { ScopeFields } from './AddAgentScope';
import { isOk, runInstall, type PairResult, type RunOutput } from './agent-install-run';
import type { AgentScope, AgentTransport, DetectedAgent } from './agent-service';

const ELLIPSIS = '…';
type Step = 'form' | 'preview' | 'done';

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
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
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [transport, setTransport] = useState<AgentTransport>('stdio');
  const [step, setStep] = useState<Step>('form');
  const [preview, setPreview] = useState<RunOutput | null>(null);
  const [outcomes, setOutcomes] = useState<PairResult[]>([]);
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

  // Selected workspaces in list order; only they take part in a workspace install.
  const chosen = workspaces.filter((item) => workspaceIds.includes(item.id)).map((item) => item.id);
  const units = scope === 'workspace' ? chosen : [undefined];
  const selectedTargets = detected.map((agent) => agent.target).filter((t) => selected.includes(t));
  // A target counts as installed only when it is ok for every selected workspace (or globally).
  const installed = detected
    .map((agent) => agent.target)
    .filter((t) => units.length > 0 && units.every((unit) => isOk(outcomes, t, unit)));
  const targets = selectedTargets.filter((target) => !installed.includes(target));
  const ready = targets.length > 0 && (scope === 'user' || chosen.length > 0);
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
      const result = await runInstall({
        targets: selectedTargets,
        scope,
        workspaceIds: chosen,
        transport,
        done: outcomes,
        dryRun,
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
    <ManagementModal
      open
      title="Connect an AI agent"
      onClose={requestClose}
      className={step === 'form' ? 'agent-modal-size-form' : 'agent-modal-size-compact'}
    >
      {error && <p role="alert">{error}</p>}
      {step === 'form' && (
        <div className="agent-modal-form">
          <h3 ref={heading} tabIndex={-1}>
            Connect your agents
          </h3>
          {outcomes.length > 0 && <OutcomeList results={outcomes} workspaces={workspaces} />}
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
            workspaceIds={workspaceIds}
            workspaces={workspaces}
            disabled={busy}
            onScope={(next) => {
              setScope(next);
              if (next === 'workspace') setTransport('stdio');
              resetOutcomes();
            }}
            onToggleWorkspace={(id) => {
              setWorkspaceIds((list) => toggle(list, id));
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
          <PreviewPanel preview={preview} workspaces={workspaces} headingRef={heading} />
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
          <OutcomeList results={outcomes} workspaces={workspaces} />
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
