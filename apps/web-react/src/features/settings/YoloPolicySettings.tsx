import { useState } from 'react';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { SwapControl } from '../../components/SwapControl';
import { patchJson } from './settings-service';

export type YoloMode = 'workspace' | 'unrestricted';
export type YoloRisk = 'prevent-high-risk' | 'do-whatever';
export interface YoloPolicy {
  mode: YoloMode;
  risk: YoloRisk;
}

interface Option<T extends string> {
  value: T;
  label: string;
  hint: string;
}

const RISK_OPTIONS: Option<YoloRisk>[] = [
  {
    value: 'prevent-high-risk',
    label: 'Prevent high risk',
    hint: 'Auto-approves everyday work; critical operations and file transfers still ask.',
  },
  {
    value: 'do-whatever',
    label: 'Do whatever',
    hint: 'No approvals when scope is Unrestricted. Secret and DLP blocking still apply.',
  },
];

const SCOPE_OPTIONS: Option<YoloMode>[] = [
  { value: 'workspace', label: 'Workspace', hint: 'Agents stay inside the workspace.' },
  {
    value: 'unrestricted',
    label: 'Unrestricted',
    hint: 'Agents may also use folders outside the workspace.',
  },
];

function YoloSwapGroup<T extends string>({
  label,
  name,
  options,
  value,
  busy,
  onSelect,
}: {
  label: string;
  name: string;
  options: Option<T>[];
  value: T;
  busy: boolean;
  onSelect(next: T): void;
}) {
  return (
    <div className="yolo-swap-group">
      <SwapControl
        name={name}
        ariaLabel={label}
        value={value}
        disabled={busy}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          hint: option.hint,
        }))}
        onChange={onSelect}
      />
      <div className="yolo-hints">
        {options.map((option) => (
          <p
            key={option.value}
            className={`console-radio-hint${value === option.value ? ' is-selected is-active' : ''}`}
          >
            {option.hint}
          </p>
        ))}
      </div>
    </div>
  );
}

export function YoloPolicySettings({
  policy,
  onChanged,
}: {
  policy: YoloPolicy;
  onChanged(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { toast, success, error } = useToast(3000);
  const dialog = useDialog();

  const save = async (patch: Partial<YoloPolicy>) => {
    setBusy(true);
    try {
      await patchJson('/api/policy/yolo', patch);
      await onChanged();
      success('YOLO policy saved.');
    } catch (cause) {
      error(cause);
    } finally {
      setBusy(false);
    }
  };

  const handleModeChange = async (mode: YoloMode) => {
    if (busy || mode === policy.mode) return;
    await save({ mode });
  };

  const handleRiskChange = async (risk: YoloRisk) => {
    if (busy || risk === policy.risk) return;
    if (risk === 'do-whatever') {
      const confirmed = await dialog.confirm({
        title: 'Turn on Do whatever?',
        message:
          'With scope Unrestricted, agents run commands and file transfers with no approval prompts. With scope Workspace, commands outside the workspace or of unknown scope still ask. Secret and DLP blocking still apply.',
        confirmLabel: 'Enable Do whatever',
        cancelLabel: 'Cancel',
        confirmTone: 'danger',
      });
      if (!confirmed) return;
    }
    await save({ risk });
  };

  return (
    <section
      className="panel settings-compact-panel yolo-policy-panel"
      role="region"
      aria-label="YOLO policy"
    >
      <div className="panel-head compact-panel-head">
        <div>
          <h3>YOLO policy</h3>
          <p>
            Risk decides which operations still ask for approval. Scope decides where agents may
            work. Sandboxes remain physically isolated; in host mode, Unrestricted commands can
            affect the whole device.
          </p>
        </div>
        {policy.risk === 'do-whatever' ? (
          <span className="yolo-danger-badge">Do whatever is on</span>
        ) : null}
      </div>
      <div className="yolo-policy-body">
        <YoloSwapGroup
          label="YOLO risk"
          name="yoloRisk"
          options={RISK_OPTIONS}
          value={policy.risk}
          busy={busy}
          onSelect={(next) => void handleRiskChange(next)}
        />
        <YoloSwapGroup
          label="YOLO scope"
          name="yoloMode"
          options={SCOPE_OPTIONS}
          value={policy.mode}
          busy={busy}
          onSelect={(next) => void handleModeChange(next)}
        />
      </div>
      {toast}
    </section>
  );
}
