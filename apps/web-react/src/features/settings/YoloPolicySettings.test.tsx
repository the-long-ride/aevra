import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YoloPolicySettings } from './YoloPolicySettings';
import * as settingsService from './settings-service';

vi.mock('./settings-service', () => ({
  patchJson: vi.fn().mockResolvedValue({ mode: 'unrestricted' }),
}));

describe('YoloPolicySettings', () => {
  it('renders the console radio options with the active mode selected', () => {
    render(<YoloPolicySettings mode="workspace" onChanged={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'YOLO policy' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'YOLO policy mode' });
    expect(group).toBeInTheDocument();

    const workspaceRadio = screen.getByRole('radio', { name: 'Workspace' });
    const unrestrictedRadio = screen.getByRole('radio', { name: 'Unrestricted' });

    expect(workspaceRadio).toBeChecked();
    expect(unrestrictedRadio).not.toBeChecked();

    const workspaceLabel = workspaceRadio.closest('label');
    expect(workspaceLabel).toHaveClass('is-selected');
  });

  it('selects new mode, calls patchJson, and triggers onChanged', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<YoloPolicySettings mode="workspace" onChanged={onChanged} />);

    const unrestrictedRadio = screen.getByRole('radio', { name: 'Unrestricted' });
    fireEvent.click(unrestrictedRadio);

    await waitFor(() => {
      expect(settingsService.patchJson).toHaveBeenCalledWith('/api/policy/yolo', {
        mode: 'unrestricted',
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('// YOLO policy saved.')).toBeInTheDocument();
  });
});
