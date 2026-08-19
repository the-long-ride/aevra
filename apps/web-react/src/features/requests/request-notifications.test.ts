import { expect, test } from 'vitest';
import { collectRequestAnnouncements } from './request-notifications';

const approval = {
  id: 'approval-1',
  state: 'PENDING',
  actor: 'ChatGPT',
  risk: 'MEDIUM',
  operation: { family: 'git:status', capability: 'commands.run' },
  presentation: {
    title: 'ChatGPT requests commands.run',
    action: 'Run command',
    target: 'git status',
  },
};

const oauth = {
  id: 'oauth-1',
  clientId: 'client-1',
  clientName: 'Claude',
  pairingCode: '1234',
  requestedScopes: ['mcp'],
};

test('first request poll announces already-pending approval and OAuth requests once', () => {
  const seenApprovals = new Set<string>();
  const seenOauth = new Set<string>();

  const first = collectRequestAnnouncements(
    [approval],
    [oauth],
    seenApprovals,
    seenOauth,
  );
  expect(first).toHaveLength(2);
  expect(first.map((item) => item.title)).toEqual([
    'Aevra: ChatGPT requests commands.run',
    'Aevra: OAuth connection request',
  ]);

  expect(
    collectRequestAnnouncements([approval], [oauth], seenApprovals, seenOauth),
  ).toEqual([]);
});

test('resolved request IDs are forgotten so a later request with the same ID can announce again', () => {
  const seenApprovals = new Set<string>();
  const seenOauth = new Set<string>();
  collectRequestAnnouncements([approval], [], seenApprovals, seenOauth);
  collectRequestAnnouncements([], [], seenApprovals, seenOauth);

  expect(
    collectRequestAnnouncements([approval], [], seenApprovals, seenOauth),
  ).toHaveLength(1);
});
