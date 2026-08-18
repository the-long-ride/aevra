import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { RequestDrawer } from './RequestDrawer';

const commandApproval = {
  id: 'approval-1',
  state: 'PENDING',
  actor: 'ChatGPT',
  risk: 'MEDIUM',
  operation: { family: 'git:status:--short', capability: 'commands.run' },
  payload: { permissionMatcher: 'git:status:--short' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status --short',
  },
};

beforeEach(() => installApiFixtures());

test('non-critical command shows once session workspace global and Saved matcher', async () => {
  installApiFixtures({ approvals: [commandApproval] });
  render(<RequestDrawer open onClose={() => undefined} />);
  expect(await screen.findByText('ChatGPT requests commands.run')).toBeInTheDocument();
  expect(screen.getByText('Saved matcher')).toBeInTheDocument();
  expect(screen.getByText('git:status:--short')).toBeInTheDocument();
  for (const label of [
    'Run once',
    'Allow this session',
    'Always in workspace',
    'Always globally',
  ]) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
});

test('CRITICAL command exposes only Deny and Run once', async () => {
  installApiFixtures({
    approvals: [{ ...commandApproval, id: 'critical-1', risk: 'CRITICAL' }],
  });
  render(<RequestDrawer open onClose={() => undefined} />);
  await screen.findByText('ChatGPT requests commands.run');
  expect(screen.getByRole('button', { name: 'Run once' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Allow this session' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Always in workspace' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Always globally' }),
  ).not.toBeInTheDocument();
});
