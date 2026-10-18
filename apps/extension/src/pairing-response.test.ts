import { expect, it } from 'vitest';
import { matchesPairingOrigin, validatePairingResponse } from './pairing-response';

it('accepts root, Browser and custom loopback listeners without remote credentials', () => {
  for (const port of [47831, 47841, 50100]) {
    expect(
      validatePairingResponse({ token: 'token', wsUrl: 'wss://localhost:50103' }, port, 'https'),
    ).toMatchObject({ pairingPort: port, pairingOrigin: `https://127.0.0.1:${port}` });
  }
  for (const input of [
    null,
    {},
    { token: '', wsUrl: 'ws://localhost' },
    { token: 'a'.repeat(17000), wsUrl: 'ws://localhost' },
    ...[
      'http://localhost',
      'ws://example.com',
      'ws://a:b@localhost',
      'ws://localhost/a',
      'ws://localhost?token=x',
      'ws://localhost#x',
      'invalid',
    ].map((wsUrl) => ({ token: 'x', wsUrl })),
  ]) {
    expect(validatePairingResponse(input, 47841, 'http')).toBeNull();
  }
});

it('nudges only the saved server origin and migrates known legacy defaults', () => {
  expect(
    matchesPairingOrigin('http://localhost:50100/settings', {
      pairingOrigin: 'http://127.0.0.1:50100',
    }),
  ).toBe(true);
  expect(matchesPairingOrigin('https://localhost:47831', { wsUrl: 'ws://127.0.0.1:47833' })).toBe(
    true,
  );
  expect(matchesPairingOrigin('http://localhost:47841', { wsUrl: 'ws://127.0.0.1:47843' })).toBe(
    true,
  );
  for (const page of ['https://evil.test/?127.0.0.1:47831', 'http://localhost:47831', 'garbage']) {
    expect(matchesPairingOrigin(page, { pairingOrigin: 'https://127.0.0.1:47831' })).toBe(false);
  }
  expect(matchesPairingOrigin('http://localhost:50100', {})).toBe(false);
});
