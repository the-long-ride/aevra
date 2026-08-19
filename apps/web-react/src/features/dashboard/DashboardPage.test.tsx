import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { DashboardPage } from './DashboardPage';

test('Runtime overview shows operational metrics without duplicating Version', async () => {
  installApiFixtures();
  render(<DashboardPage />);

  expect(await screen.findByText('Remote sessions')).toBeInTheDocument();
  expect(screen.getByText('Workspace leases')).toBeInTheDocument();
  expect(screen.getByText('Pending requests')).toBeInTheDocument();
  expect(screen.queryByText('Version')).not.toBeInTheDocument();
});
