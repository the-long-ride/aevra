import { useEffect, useId, useMemo, useState } from 'react';
import { requestJson } from '../../services/api-client';

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: DirectoryEntry[];
}

interface PickerResult {
  status: 'selected';
  path: string;
}

function breadcrumbs(value: string): Array<{ label: string; path: string }> {
  if (!value) return [];
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    const drive = value.slice(0, 2);
    const parts = value
      .slice(2)
      .split(/[\\/]+/)
      .filter(Boolean);
    const result = [{ label: `${drive}\\`, path: `${drive}\\` }];
    let current = `${drive}\\`;
    for (const part of parts) {
      current = current.endsWith('\\') ? `${current}${part}` : `${current}\\${part}`;
      result.push({ label: part, path: current });
    }
    return result;
  }
  if (value.startsWith('/')) {
    const parts = value.split('/').filter(Boolean);
    const result = [{ label: '/', path: '/' }];
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      result.push({ label: part, path: current });
    }
    return result;
  }
  return [{ label: value, path: value }];
}

export function AddWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(): Promise<void> | void;
}) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [serverPath, setServerPath] = useState('');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const crumbs = useMemo(
    () => breadcrumbs(listing?.path ?? serverPath),
    [listing?.path, serverPath],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const value = serverPath.trim();
    if (!value) {
      setListing(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void requestJson<DirectoryListing>(
        `/api/local/directories?path=${encodeURIComponent(value)}`,
        {
          signal: controller.signal,
        },
      )
        .then((next) => {
          if (controller.signal.aborted) return;
          setListing(next);
          setError('');
          if (next.path !== serverPath) setServerPath(next.path);
        })
        .catch((failure) => {
          if (controller.signal.aborted) return;
          setListing(null);
          setError(failure instanceof Error ? failure.message : String(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [serverPath]);

  const browseOnServer = async () => {
    try {
      const selected = await requestJson<PickerResult>('/api/local/folder-picker', {
        method: 'POST',
        body: '{}',
      });
      setServerPath(selected.path);
      setError('');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(`${message}. Enter or browse the server path below.`);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = serverPath.trim();
    if (!trimmedName || !trimmedPath) return;
    setSubmitting(true);
    try {
      await requestJson('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: trimmedName, hostRoot: trimmedPath }),
      });
      await onCreated();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop add-workspace-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <form
        className="modal add-workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>Add workspace</h2>
            <p>Register a project directory on the machine running Aevra.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Add workspace">
            Close
          </button>
        </div>
        <div className="modal-body add-workspace-body">
          <div className="add-workspace-fields">
            <label className="field">
              <span>Workspace name</span>
              <input
                autoFocus
                value={name}
                required
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label className="field add-workspace-path-field">
              <span>Server path</span>
              <input
                value={serverPath}
                required
                placeholder="Absolute path on the Aevra host"
                onChange={(event) => setServerPath(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="add-workspace-toolbar">
            <button type="button" onClick={() => void browseOnServer()}>
              Browse on server
            </button>
            <button
              type="button"
              disabled={!listing?.parent}
              onClick={() => listing?.parent && setServerPath(listing.parent)}
            >
              Up
            </button>
            <span>
              {loading ? 'Loading directories…' : 'Browse one directory level at a time.'}
            </span>
          </div>

          {crumbs.length ? (
            <nav className="path-breadcrumbs" aria-label="Server path breadcrumbs">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.path}-${index}`}>
                  {index ? <span className="breadcrumb-separator">/</span> : null}
                  <button type="button" onClick={() => setServerPath(crumb.path)}>
                    {crumb.label}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}

          <div className="directory-browser" aria-label="Server directories">
            {listing?.directories.length ? (
              listing.directories.map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  className="directory-row"
                  onClick={() => setServerPath(directory.path)}
                >
                  <span>{directory.name}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))
            ) : (
              <p className="empty-note">
                {listing ? 'No child directories.' : 'Enter an absolute server path to browse.'}
              </p>
            )}
          </div>

          {error ? <p className="inline-result warning-text">{error}</p> : null}
        </div>
        <div className="modal-foot add-workspace-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={submitting || !name.trim() || !serverPath.trim()}>
            {submitting ? 'Adding…' : 'Add workspace'}
          </button>
        </div>
      </form>
    </div>
  );
}
