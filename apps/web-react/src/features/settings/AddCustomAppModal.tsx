import { useState } from 'react';
import { SettingsFormModal } from './SettingsFormModal';
import { canonicalWindowsPath } from './custom-app-migration';
import type { DetectedApp } from './DesktopControlSettings';

function extractExeBasename(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : '';
}

export function AddCustomAppModal({
  open,
  initialApp,
  existingPaths = [],
  onClose,
  onSave,
}: {
  open: boolean;
  initialApp?: DetectedApp | null;
  existingPaths?: string[];
  onClose(): void;
  onSave(app: DetectedApp, previousExeBasename?: string): void;
}) {
  const [executablePath, setExecutablePath] = useState(initialApp?.executablePath ?? '');
  const [displayName, setDisplayName] = useState(initialApp?.displayName ?? '');
  const [version, setVersion] = useState(initialApp?.version ?? '');
  const [error, setError] = useState('');

  if (!open) return null;

  const isEditing = Boolean(initialApp);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmedPath = executablePath.trim();
    if (!trimmedPath) {
      setError('Executable file path is required.');
      return;
    }

    const exeBasename = extractExeBasename(trimmedPath);
    if (!exeBasename) {
      setError('Could not determine program file name from the provided path.');
      return;
    }

    const pathKey = canonicalWindowsPath(trimmedPath);
    const previousPathKey = initialApp?.executablePath
      ? canonicalWindowsPath(initialApp.executablePath)
      : undefined;
    if (
      pathKey !== previousPathKey &&
      existingPaths.some((entry) => canonicalWindowsPath(entry) === pathKey)
    ) {
      setError('This executable path is already in the catalog.');
      return;
    }

    const name = displayName.trim() || exeBasename;
    const ver = version.trim() || null;

    onSave(
      {
        displayName: name,
        version: ver,
        executablePath: trimmedPath,
        exeBasename,
        isCustom: true,
      },
      initialApp?.exeBasename,
    );

    onClose();
  };

  return (
    <SettingsFormModal
      title={isEditing ? 'Edit custom app' : 'Add custom app'}
      description={
        isEditing
          ? 'Update custom application details and program file path.'
          : 'Add an application to the shared catalog with its program file path. Use its switch to grant computer-use access. Version is optional.'
      }
      submitting={false}
      submitLabel={isEditing ? 'Save changes' : 'Add application'}
      submittingLabel="Saving…"
      halfWidth
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="settings-modal-fields">
        <label className="field" htmlFor="customAppExecutablePath">
          <span>Program file path</span>
          <input
            id="customAppExecutablePath"
            name="executablePath"
            value={executablePath}
            autoFocus
            required
            placeholder="C:\Program Files\App\app.exe"
            onChange={(event) => setExecutablePath(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="customAppDisplayName">
          <span>Application name (optional)</span>
          <input
            id="customAppDisplayName"
            name="displayName"
            value={displayName}
            placeholder="e.g. My App"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="customAppVersion">
          <span>Version (optional)</span>
          <input
            id="customAppVersion"
            name="version"
            value={version}
            placeholder="e.g. 1.0.0"
            onChange={(event) => setVersion(event.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="inline-result warning-text">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsFormModal>
  );
}
