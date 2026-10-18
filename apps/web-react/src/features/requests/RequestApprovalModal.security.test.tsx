import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestApprovalModal } from './RequestApprovalModal';

test('OAuth review shows redirect origin, client ID and duplicate-name warning', () => {
  installApiFixtures();
  render(
    <DialogProvider>
      <RequestApprovalModal
        data={{
          approvals: [],
          workspaces: [],
          oauth: [
            {
              id: 'one',
              pairingCode: 'ordinary code',
              clientName: 'ChatGPT',
              clientId: 'client-one',
              redirectOrigin: 'https://lookalike.example',
              duplicateClientName: true,
            } as any,
          ],
        }}
        onActioned={vi.fn()}
        onDismiss={vi.fn()}
      />
    </DialogProvider>,
  );
  expect(screen.getByText('https://lookalike.example')).toBeInTheDocument();
  expect(screen.getByText('client-one')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('same name');
});
