import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AddAgentModal } from './AddAgentModal';
import { AgentConnectionsTable, registrationKey } from './AgentConnectionsTable';
import {
  detectAgents,
  installAgents,
  loadAgents,
  loadWorkspaces,
  uninstallAgent,
  type AgentInstallResponse,
  type AgentRegistration,
  type DetectedAgent,
} from './agent-service';

type Load = 'loading' | 'ready' | 'failed';

function reason(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function failureText(result: AgentInstallResponse) {
  const failed = result.results.find((item) => !item.ok);
  return failed ? `${failed.target}: ${failed.error ?? 'Unknown error'}` : '';
}

// A request is current only while the panel is mounted and no newer request of its kind started.
function track(sequence: RefObject<number>, alive: RefObject<boolean>) {
  const mine = ++sequence.current;
  return () => alive.current && sequence.current === mine;
}

export function AgentIntegrationsSettings() {
  const [registrations, setRegistrations] = useState<AgentRegistration[]>([]);
  const [detected, setDetected] = useState<DetectedAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [agentsState, setAgentsState] = useState<Load>('loading');
  const [detectState, setDetectState] = useState<Load>('loading');
  const [pending, setPending] = useState<{ key: string; action: 'update' | 'remove' } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [detectError, setDetectError] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [actionError, setActionError] = useState('');
  const alive = useRef(true);
  const agentSeq = useRef(0);
  const detectSeq = useRef(0);
  const workspaceSeq = useRef(0);

  const reloadAgents = useCallback(async () => {
    const current = track(agentSeq, alive);
    try {
      const value = await loadAgents();
      if (!current()) return;
      setRegistrations(value.registrations);
      setAgentsState('ready');
      setLoadError('');
    } catch (cause) {
      if (!current()) return;
      setAgentsState('failed');
      setLoadError(reason(cause));
    }
  }, []);
  const rescan = useCallback(async () => {
    setMessage('');
    setActionError('');
    setDetectError('');
    setWorkspaceError('');
    setAgentsState('loading');
    setDetectState('loading');
    const detectCurrent = track(detectSeq, alive);
    const workspaceCurrent = track(workspaceSeq, alive);
    await Promise.all([
      reloadAgents(),
      detectAgents().then(
        (value) => {
          if (!detectCurrent()) return;
          setDetected(value);
          setDetectState('ready');
        },
        (cause) => {
          if (!detectCurrent()) return;
          setDetectState('failed');
          setDetectError(reason(cause));
        },
      ),
      loadWorkspaces().then(
        (value) => {
          if (workspaceCurrent()) setWorkspaces(value);
        },
        (cause) => {
          if (workspaceCurrent()) setWorkspaceError(reason(cause));
        },
      ),
    ]);
  }, [reloadAgents]);

  useEffect(() => {
    alive.current = true;
    void rescan();
    return () => {
      alive.current = false;
    };
  }, [rescan]);

  async function change(item: AgentRegistration, action: 'update' | 'remove') {
    if (pending) return;
    setPending({ key: registrationKey(item), action });
    setActionError('');
    setMessage('');
    try {
      const result =
        action === 'remove'
          ? await uninstallAgent(item)
          : await installAgents({
              targets: [item.target],
              scope: item.scope,
              ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
              transport: item.transport,
            });
      await reloadAgents();
      const failure = failureText(result);
      if (failure) setActionError(failure);
      else setMessage(result.message);
    } catch (cause) {
      setActionError(reason(cause));
    } finally {
      setPending(null);
    }
  }

  const alerts = [loadError, detectError, actionError].filter(Boolean);
  return (
    <section className="panel settings-compact-panel" aria-labelledby="agent-integrations-title">
      <div className="panel-head compact-panel-head">
        <div>
          <h3 id="agent-integrations-title">Local AI agents</h3>
          <p>
            Connect this gateway to your local agents, for all projects or one workspace. Skills
            live once in ~/.agents/skills with managed links.
          </p>
        </div>
        <div className="actions compact-settings-actions">
          <button
            type="button"
            className="primary"
            disabled={!!pending}
            onClick={() => setModalOpen(true)}
          >
            Add connection
          </button>
          <button type="button" disabled={!!pending} onClick={() => void rescan()}>
            Rescan
          </button>
        </div>
      </div>
      {alerts.length > 0 && (
        <div role="alert">
          {alerts.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <AgentConnectionsTable
        registrations={registrations}
        workspaces={workspaces}
        pending={pending}
        status={agentsState}
        onUpdate={(item) => void change(item, 'update')}
        onRemove={(item) => void change(item, 'remove')}
      />
      <p>
        Existing approvals and access grants still apply. Refresh or restart the agent after a
        change.
      </p>
      {modalOpen && (
        <AddAgentModal
          detected={detected}
          detectStatus={detectState}
          detectError={detectError}
          workspaces={workspaces}
          workspaceError={workspaceError}
          onClose={() => setModalOpen(false)}
          onChanged={() => void reloadAgents()}
        />
      )}
    </section>
  );
}
