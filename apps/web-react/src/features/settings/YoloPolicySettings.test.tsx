import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { YoloPolicySettings } from './YoloPolicySettings';
import * as settingsService from './settings-service';

vi.mock('./settings-service', () => ({
  patchJson: vi.fn().mockResolvedValue(undefined),
}));

type Policy = { mode: 'workspace' | 'unrestricted'; risk: 'prevent-high-risk' | 'do-whatever' };

function renderPanel(policy: Policy, onChanged = vi.fn().mockResolvedValue(undefined)) {
  render(
    <DialogProvider>
      <YoloPolicySettings policy={policy} onChanged={onChanged} />
    </DialogProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.mocked(settingsService.patchJson).mockClear();
});

describe('YoloPolicySettings', () => {
  it('renders risk and scope radiogroups with the active values selected', () => {
    renderPanel({ mode: 'workspace', risk: 'prevent-high-risk' });

    expect(screen.getByRole('heading', { name: 'YOLO policy' })).toBeInTheDocument();
    const risk = screen.getByRole('radiogroup', { name: 'YOLO risk' });
    const scope = screen.getByRole('radiogroup', { name: 'YOLO scope' });
    expect(risk).toBeInTheDocument();
    expect(scope).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: /Prevent high risk/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Do whatever/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Workspace/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Unrestricted/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Workspace/ }).closest('label')).toHaveClass(
      'is-selected',
    );
    expect(
      screen.getByText(
        'Auto-approves everyday work; critical operations and file transfers still ask.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No approvals when scope is Unrestricted. Secret and DLP blocking still apply.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Agents stay inside the workspace.')).toBeInTheDocument();
    expect(
      screen.getByText('Agents may also use folders outside the workspace.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.yolo-danger-badge')).toBeNull();
  });

  it('scope change PATCHes only mode', async () => {
    const onChanged = renderPanel({ mode: 'workspace', risk: 'prevent-high-risk' });
    fireEvent.click(screen.getByRole('radio', { name: /Unrestricted/ }));

    await waitFor(() => {
      expect(settingsService.patchJson).toHaveBeenCalledWith('/api/policy/yolo', {
        mode: 'unrestricted',
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(settingsService.patchJson).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('YOLO policy saved.')).toBeInTheDocument();
  });

  it('choosing Do whatever asks for danger confirmation and PATCHes only risk when confirmed', async () => {
    const onChanged = renderPanel({ mode: 'workspace', risk: 'prevent-high-risk' });
    fireEvent.click(screen.getByRole('radio', { name: /Do whatever/ }));

    const confirm = await screen.findByRole('button', { name: /Enable Do whatever|Confirm|Yes/i });
    expect(settingsService.patchJson).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(settingsService.patchJson).toHaveBeenCalledWith('/api/policy/yolo', {
        risk: 'do-whatever',
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it('cancelling the confirmation sends nothing', async () => {
    renderPanel({ mode: 'workspace', risk: 'prevent-high-risk' });
    fireEvent.click(screen.getByRole('radio', { name: /Do whatever/ }));

    const cancel = await screen.findByRole('button', { name: /Cancel/i });
    fireEvent.click(cancel);

    await waitFor(() => expect(screen.queryByRole('button', { name: /Cancel/i })).toBeNull());
    expect(settingsService.patchJson).not.toHaveBeenCalled();
  });

  it('moving back to Prevent high risk needs no confirmation', async () => {
    renderPanel({ mode: 'workspace', risk: 'do-whatever' });
    fireEvent.click(screen.getByRole('radio', { name: /Prevent high risk/ }));

    await waitFor(() =>
      expect(settingsService.patchJson).toHaveBeenCalledWith('/api/policy/yolo', {
        risk: 'prevent-high-risk',
      }),
    );
  });

  it('shows the danger badge when risk is do-whatever', () => {
    renderPanel({ mode: 'workspace', risk: 'do-whatever' });
    const badge = document.querySelector('.yolo-danger-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('Do whatever is on');
  });

  it('surfaces a failed save and does not call onChanged', async () => {
    vi.mocked(settingsService.patchJson).mockRejectedValueOnce(new Error('boom'));
    const onChanged = renderPanel({ mode: 'workspace', risk: 'prevent-high-risk' });
    fireEvent.click(screen.getByRole('radio', { name: /Unrestricted/ }));
    await waitFor(() => expect(settingsService.patchJson).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
