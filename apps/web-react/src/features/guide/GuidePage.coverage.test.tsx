import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { GuidePage } from './GuidePage';

describe('GuidePage coverage', () => {
  const writeText = vi.fn();

  beforeEach(() => {});

  it('renders rich markdown tokens and code fences', async () => {
    installApiFixtures({
      routes: {
        '/api/guide': [
          { slug: 'intro', title: 'Intro', file: 'intro.md' },
          { slug: 'details', title: 'Details', file: 'details.md' },
        ],
        '/manual/intro.md': [
          '# Intro Heading',
          '',
          'Intro text with `code token` and [link](https://example.com) and [internal](/guide) and [unsafe](ftp://example.com).',
          '',
          '## Heading 4',
          '### Heading 5',
          '#### Heading Max',
          '',
          '- List item 1',
          '- List item 2',
          '',
          '```ts',
          'const a = 1;',
          '```',
          '',
          '```',
          'raw code without lang',
          '```',
          '',
          'A multi-line',
          'paragraph here.',
        ].join('\n'),
      },
    });

    render(<GuidePage />);

    expect(await screen.findByRole('heading', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByText('code token')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');

    const internal = screen.getByRole('link', { name: 'internal' });
    expect(internal).toHaveAttribute('href', '/guide');
    expect(internal).not.toHaveAttribute('target');

    // Unsafe link rendered as plain text
    expect(screen.getByText(/unsafe/)).toBeInTheDocument();

    // Headings
    expect(screen.getByRole('heading', { level: 4, name: 'Heading 4' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'Heading 5' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'Heading Max' })).toBeInTheDocument();

    // Code blocks
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('raw code without lang')).toBeInTheDocument();
  });

  it('handles navigation between chapters, previous and next buttons, and empty search results', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/guide': [
          { slug: 'chap-1', title: 'Chapter 1', file: 'ch1.md' },
          { slug: 'chap-2', title: 'Chapter 2', file: 'ch2.md' },
        ],
        '/manual/ch1.md': '# Ch1\n\nContent 1',
        '/manual/ch2.md': '# Ch2\n\nContent 2',
      },
    });

    render(<GuidePage />);

    expect(await screen.findByText('Content 1')).toBeInTheDocument();

    // Previous is disabled on first chapter
    const prevBtn = screen.getByRole('button', { name: 'Previous' });
    expect(prevBtn).toBeDisabled();

    // Next button moves to chapter 2
    const nextBtn = screen.getByRole('button', { name: 'Next: Chapter 2' });
    expect(nextBtn).toBeEnabled();
    await user.click(nextBtn);

    expect(await screen.findByText('Content 2')).toBeInTheDocument();
    const prevActiveBtn = screen.getByRole('button', { name: 'Previous: Chapter 1' });
    expect(prevActiveBtn).toBeEnabled();

    // Clicking previous returns to chapter 1
    await user.click(prevActiveBtn);
    expect(await screen.findByText('Content 1')).toBeInTheDocument();

    // Search with no results
    const search = screen.getByRole('searchbox', { name: 'Search chapters' });
    await user.type(search, 'non-existent-xyz');
    expect(screen.getByText('No matching chapters.')).toBeInTheDocument();
    await user.clear(search);
  });

  it('handles API errors gracefully', async () => {
    installApiFixtures({
      routes: {
        '/api/guide': () => {
          throw new Error('Guide fetch error');
        },
      },
    });

    render(<GuidePage />);
    expect(await screen.findByText(/Unexpected end of JSON/i)).toBeInTheDocument();
  });

  it('handles platform tab switching and copy buttons in safe command matchers', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/guide': [
          { slug: 'safe-command-matchers', title: 'Safe Matchers', file: 'matchers.md' },
        ],
        '/manual/matchers.md': '# Safe Matchers\n\nMatcher table guide',
      },
    });
    const write = vi.mocked(navigator.clipboard.writeText);

    render(<GuidePage />);

    expect(await screen.findByText('Matcher table guide')).toBeInTheDocument();

    // Switch platform tabs
    const linuxTab = screen.getByRole('button', { name: 'Linux' });
    await user.click(linuxTab);
    expect(linuxTab).toHaveClass('active');

    const macTab = screen.getByRole('button', { name: 'macOS' });
    await user.click(macTab);
    expect(macTab).toHaveClass('active');

    const winTab = screen.getByRole('button', { name: 'Windows' });
    await user.click(winTab);
    expect(winTab).toHaveClass('active');

    // Copy all
    const copyAll = screen.getByRole('button', { name: 'Copy all' });
    await user.click(copyAll);
    expect(write).toHaveBeenCalled();
  });
});
