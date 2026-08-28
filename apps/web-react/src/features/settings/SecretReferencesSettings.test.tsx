import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SecretReferencesSettings } from './SecretReferencesSettings';

test('secret references normalize string, ref, key, and empty record shapes', () => {
  render(
    <SecretReferencesSettings
      secretRefs={['STRING_REF', { ref: 'OBJECT_REF' }, { key: 'KEY_REF' }, {}]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByText('4 locally stored references.')).toBeInTheDocument();
  expect(screen.getByText('STRING_REF')).toBeInTheDocument();
  expect(screen.getByText('OBJECT_REF')).toBeInTheDocument();
  expect(screen.getByText('KEY_REF')).toBeInTheDocument();
  expect(screen.getAllByText('Configured')).toHaveLength(4);
});
