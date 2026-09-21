import type { CommandRuleV2 } from '@aevra/admin-contracts';
import { useState } from 'react';

export interface CommandRuleEditorProps {
  initialRule?: Partial<CommandRuleV2>;
  onSave(rule: CommandRuleV2): void;
  onCancel(): void;
}

export function CommandRuleEditor({ initialRule, onSave, onCancel }: CommandRuleEditorProps) {
  const [application, setApplication] = useState(initialRule?.application ?? 'git');
  const [operationStr, setOperationStr] = useState(initialRule?.operation?.join(' ') ?? 'status');
  const [scriptName, setScriptName] = useState(initialRule?.scriptName ?? '');
  const [modifiersStr, setModifiersStr] = useState(initialRule?.allowedModifiers?.join(', ') ?? '');
  const [dialects, setDialects] = useState<string[]>(
    initialRule?.dialects ?? ['direct', 'bash', 'pwsh', 'cmd'],
  );
  const [backends, setBackends] = useState<string[]>(initialRule?.backends ?? ['host']);

  const toggleDialect = (d: string) => {
    setDialects((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const toggleBackend = (b: string) => {
    setBackends((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));
  };

  const rule: CommandRuleV2 = {
    ...(initialRule as Partial<CommandRuleV2>),
    version: 2,
    application: application.trim(),
    operation: operationStr
      .split(/\s+/)
      .map((s: string) => s.trim())
      .filter(Boolean),
    scriptName: scriptName.trim() || undefined,
    allowedModifiers: modifiersStr
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    allowedOptions: initialRule?.allowedOptions ?? [],
    positionalConstraint: initialRule?.positionalConstraint ?? 'workspace-paths',
    targetScope: initialRule?.targetScope ?? 'workspace',
    backends: backends as any[],
    dialects: dialects as any[],
    executableFingerprint: initialRule?.executableFingerprint ?? '*',
    wrapperFingerprints: initialRule?.wrapperFingerprints ?? ['*'],
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(rule);
  };

  return (
    <form
      onSubmit={handleSave}
      className="command-rule-editor"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      <h4>Typed Command Rule (V2)</h4>

      <label>
        <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8 }}>Application:</span>
        <input
          type="text"
          value={application}
          onChange={(e) => setApplication(e.target.value)}
          required
          style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }}
        />
      </label>

      <label>
        <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8 }}>Operation:</span>
        <input
          type="text"
          value={operationStr}
          onChange={(e) => setOperationStr(e.target.value)}
          required
          style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }}
        />
      </label>

      {application === 'npm' || application === 'pnpm' || application === 'yarn' ? (
        <label>
          <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8 }}>Script Name:</span>
          <input
            type="text"
            value={scriptName}
            onChange={(e) => setScriptName(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }}
          />
        </label>
      ) : null}

      <label>
        <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8 }}>
          Allowed Modifiers (comma-separated):
        </span>
        <input
          type="text"
          placeholder="e.g. force, force-with-lease, hard"
          value={modifiersStr}
          onChange={(e) => setModifiersStr(e.target.value)}
          style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem' }}
        />
      </label>

      <div>
        <span
          style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.2rem' }}
        >
          Dialects:
        </span>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {['direct', 'bash', 'pwsh', 'cmd', 'zsh'].map((d) => (
            <label
              key={d}
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}
            >
              <input
                type="checkbox"
                checked={dialects.includes(d)}
                onChange={() => toggleDialect(d)}
              />
              {d}
            </label>
          ))}
        </div>
      </div>

      <div>
        <span
          style={{ display: 'block', fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.2rem' }}
        >
          Backends:
        </span>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {['host', 'sandbox'].map((b) => (
            <label
              key={b}
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}
            >
              <input
                type="checkbox"
                checked={backends.includes(b)}
                onChange={() => toggleBackend(b)}
              />
              {b}
            </label>
          ))}
        </div>
      </div>

      <div
        style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}
      >
        <button type="button" onClick={onCancel} className="btn secondary">
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Save Rule
        </button>
      </div>
    </form>
  );
}
