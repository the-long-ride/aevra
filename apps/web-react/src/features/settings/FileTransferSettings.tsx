import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { patchJson } from './settings-service';

const PATH = '/api/files/transfer-settings';

interface TransferLimits {
  maxFileMb: number;
  maxBatchMb: number;
  inlineMb: number;
}

export function FileTransferSettings() {
  const [limits, setLimits] = useState<TransferLimits | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast, error, success } = useToast();

  const load = () =>
    requestJson<TransferLimits>(PATH)
      .then((loaded) => {
        setLimits(loaded);
        setFailed(false);
      })
      .catch(() => setFailed(true));

  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Object.fromEntries(new FormData(event.currentTarget));
    setSaved(false);
    try {
      await patchJson(PATH, {
        maxFileMb: Number(value.maxFileMb),
        maxBatchMb: Number(value.maxBatchMb),
        inlineMb: Number(value.inlineMb),
      });
      await load();
      setSaved(true);
      success('File transfer limits saved.');
    } catch (cause) {
      error(cause);
    }
  };

  return (
    <section className="panel settings-compact-panel file-transfer-panel">
      <div className="panel-head compact-panel-head">
        <div>
          <h3>File transfer</h3>
          <p>Size limits for files_download and files_upload. Values are in megabytes.</p>
        </div>
      </div>
      {failed ? (
        <p role="alert">Could not load transfer limits.</p>
      ) : limits ? (
        <form className="compact-settings-form" onSubmit={submit}>
          <div className="compact-control-grid file-transfer-grid">
            <label className="field">
              <span>Max file size (MB)</span>
              <input
                type="number"
                name="maxFileMb"
                min={1}
                max={10240}
                defaultValue={limits.maxFileMb}
              />
            </label>
            <label className="field">
              <span>Max batch size (MB)</span>
              <input
                type="number"
                name="maxBatchMb"
                min={1}
                max={10240}
                defaultValue={limits.maxBatchMb}
              />
            </label>
            <label className="field">
              <span>Max inline size (MB)</span>
              <input
                type="number"
                name="inlineMb"
                min={1}
                max={256}
                defaultValue={limits.inlineMb}
              />
            </label>
            <div className="file-transfer-action">
              <button className="primary" data-surface-id="settings:save-file-transfer">
                Save transfer limits
              </button>
              {saved ? <span role="status">Saved</span> : null}
            </div>
          </div>
        </form>
      ) : (
        <p role="status">Loading transfer limits...</p>
      )}
      {toast}
    </section>
  );
}
