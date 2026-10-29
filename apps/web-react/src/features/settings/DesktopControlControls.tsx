import { memo } from 'react';
import { SwapControl, type SwapOption } from '../../components/SwapControl';
import { Switch } from '../../components/Switch';

interface DesktopModeSelectorProps {
  mode: 'allowlist' | 'denylist';
  disabled: boolean;
  onModeChange: (mode: 'allowlist' | 'denylist') => void;
}

const DESKTOP_MODE_OPTIONS: SwapOption<'allowlist' | 'denylist'>[] = [
  { value: 'denylist', label: 'Allow all apps' },
  { value: 'allowlist', label: 'Only these apps' },
];

export const DesktopModeSelector = memo(function DesktopModeSelector({
  mode,
  disabled,
  onModeChange,
}: DesktopModeSelectorProps) {
  return (
    <fieldset className="console-fieldset">
      <legend>Apps computer use can touch</legend>
      <SwapControl
        name="desktopMode"
        ariaLabel="Apps computer use can touch"
        value={mode}
        disabled={disabled}
        options={DESKTOP_MODE_OPTIONS}
        onChange={onModeChange}
      />
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
