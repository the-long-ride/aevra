import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { PermissionsPage } from './PermissionsPage';

test('permission form renders every capability as a switch including skills and instructions', async () => {
  const user = userEvent.setup();
  installApiFixtures({ routes: { '/api/permissions': [] } });
  render(<PermissionsPage />);
  await user.click(await screen.findByRole('button', { name: 'Add rules' }));

  for (const capability of [
    'files.read',
    'files.search',
    'git.read',
    'skills.read',
    'instructions.read',
    'files.write',
    'files.delete',
    'commands.run',
    'git.commit',
    'git.push',
    'network',
    'skills.write',
    'instructions.write',
  ]) {
    expect(screen.getByRole('switch', { name: capability })).toBeInTheDocument();
  }
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

  await user.click(screen.getByRole('switch', { name: 'commands.run' }));
  expect(screen.getByLabelText(/Command matchers/)).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'commands.run' })).toHaveFocus();
});
