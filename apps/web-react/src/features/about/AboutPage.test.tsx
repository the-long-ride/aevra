import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { AboutPage } from './AboutPage';

describe('AboutPage', () => {
  beforeEach(() => {
    installApiFixtures();
  });

  test('renders about page title and author without a separate Note row', async () => {
    render(<AboutPage />);
    expect(await screen.findByRole('heading', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByText('the-long-ride')).toBeInTheDocument();
    expect(screen.getByText(/made by <3/)).toBeInTheDocument();
    expect(screen.queryByText('Note', { selector: 'dt' })).not.toBeInTheDocument();
  });

  test('renders github profile, repository, and issues links', async () => {
    render(<AboutPage />);
    const profileLink = await screen.findByRole('link', { name: /GitHub Profile/ });
    expect(profileLink).toHaveAttribute('href', 'https://github.com/the-long-ride');
    expect(profileLink).toHaveAttribute('target', '_blank');
    expect(profileLink).toHaveAttribute('rel', 'noreferrer');

    const repoLink = screen.getByRole('link', { name: /GitHub Repository/ });
    expect(repoLink).toHaveAttribute('href', 'https://github.com/the-long-ride/aevra');
    expect(repoLink).toHaveAttribute('target', '_blank');

    const issuesLink = screen.getByRole('link', { name: /GitHub Issues/ });
    expect(issuesLink).toHaveAttribute('href', 'https://github.com/the-long-ride/aevra/issues');
    expect(issuesLink).toHaveAttribute('target', '_blank');
  });

  test('renders version from runtime status', async () => {
    render(<AboutPage />);
    // installApiFixtures provides version '0.1.0'
    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
  });

  test('renders version when it already starts with v', async () => {
    installApiFixtures({
      routes: {
        '/api/status': { version: 'v2.3.4' },
      },
    });
    render(<AboutPage />);
    expect(await screen.findByText('v2.3.4')).toBeInTheDocument();
  });

  test('renders fallback version when status version is undefined', async () => {
    installApiFixtures({
      routes: {
        '/api/status': {},
      },
    });
    render(<AboutPage />);
    expect(await screen.findByText('v1.1.1')).toBeInTheDocument();
  });
});
