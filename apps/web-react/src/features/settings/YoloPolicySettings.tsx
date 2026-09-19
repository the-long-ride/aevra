import { useEffect, useState } from 'react';
import { patchJson } from './settings-service';

export type YoloMode = 'workspace' | 'unrestricted';

export function YoloPolicySettings({
  mode,
  onChanged,
}: {
  mode: YoloMode;
  onChanged(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleModeChange = async (nextMode: YoloMode) => {
    if (busy || nextMode === mode) return;
    setBusy(true);
    try {
      await patchJson('/api/policy/yolo', { mode: nextMode });
      await onChanged();
      setToast('// YOLO policy saved.');
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
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
          <p>Workspace mode still requires confirmation for critical work.</p>
        </div>
      </div>
      <div className="yolo-policy-body">
        <div className="console-radio-group" role="radiogroup" aria-label="YOLO policy mode">
          <label
            className={`console-radio-option${mode === 'workspace' ? ' is-selected' : ''}${busy ? ' is-disabled' : ''}`}
          >
            <input
              type="radio"
              name="yoloMode"
              value="workspace"
              checked={mode === 'workspace'}
              disabled={busy}
              onChange={() => void handleModeChange('workspace')}
            />
            <span>Workspace</span>
          </label>
          <label
            className={`console-radio-option${mode === 'unrestricted' ? ' is-selected' : ''}${busy ? ' is-disabled' : ''}`}
          >
            <input
              type="radio"
              name="yoloMode"
              value="unrestricted"
              checked={mode === 'unrestricted'}
              disabled={busy}
              onChange={() => void handleModeChange('unrestricted')}
            />
            <span>Unrestricted</span>
          </label>
        </div>
      </div>
      {toast ? (
        <div className="toast-stack">
          <div className="toast success" role="status">
            {toast}
          </div>
        </div>
      ) : null}
    </section>
  );
}
