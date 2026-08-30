import { patchJson } from './settings-service';

export type YoloMode = 'workspace' | 'unrestricted';

export function YoloPolicySettings({
  mode,
  onChanged,
}: {
  mode: YoloMode;
  onChanged(): Promise<void>;
}) {
  return (
    <section className="panel settings-compact-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>YOLO policy</h3>
          <p>Workspace mode still requires confirmation for critical work.</p>
        </div>
        <label className="field">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) =>
              void patchJson('/api/policy/yolo', { mode: event.currentTarget.value }).then(
                onChanged,
              )
            }
          >
            <option value="workspace">Workspace</option>
            <option value="unrestricted">Unrestricted</option>
          </select>
        </label>
      </div>
    </section>
  );
}
