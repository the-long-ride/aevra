import { memo } from 'react';
import { Switch } from '../../components/Switch';

interface DesktopModeSelectorProps {
  mode: 'allowlist' | 'denylist';
  disabled: boolean;
  onModeChange: (mode: 'allowlist' | 'denylist') => void;
}

export const DesktopModeSelector = memo(function DesktopModeSelector({
  mode,
  disabled,
  onModeChange,
}: DesktopModeSelectorProps) {
  return (
    <fieldset className="console-fieldset">
      <legend>Apps computer use can touch</legend>
      <div
        className="console-radio-group"
        role="radiogroup"
        aria-label="Apps computer use can touch"
      >
        <label
          className={`console-radio-option${mode === 'denylist' ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name="desktopMode"
            value="denylist"
            checked={mode === 'denylist'}
            disabled={disabled}
            onChange={() => onModeChange('denylist')}
          />
          <span>Allow all apps</span>
        </label>
        <label
          className={`console-radio-option${mode === 'allowlist' ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name="desktopMode"
            value="allowlist"
            checked={mode === 'allowlist'}
            disabled={disabled}
            onChange={() => onModeChange('allowlist')}
          />
          <span>Only these apps</span>
        </label>
      </div>
      <p className="section-note console-radio-hint">
        {mode === 'denylist'
          ? 'Only a few sensitive apps stay blocked.'
          : 'Computer use is refused for anything not checked below.'}{' '}
        Switching mode clears the list, because an allow list and a block list cannot mean the same
        thing.
      </p>
    </fieldset>
  );
});

interface DesktopPathExposureProps {
  exposeExecutablePaths: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export const DesktopPathExposure = memo(function DesktopPathExposure({
  exposeExecutablePaths,
  disabled,
  onChange,
}: DesktopPathExposureProps) {
  return (
    <div className="desktop-path-exposure-row">
      <Switch
        checked={exposeExecutablePaths}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        containerClassName="desktop-path-exposure-label"
        label={
          <div className="desktop-path-exposure-info">
            <span className="desktop-path-exposure-title">Show file paths to the AI</span>
            <span className="section-note">
              Include full executable filesystem paths in computer-use tool responses.
            </span>
          </div>
        }
      />
    </div>
  );
});
