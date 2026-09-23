import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { buildAiGuidePrompt, GuideAiPrompt } from './GuideAiPrompt';
import { GuidePage } from './GuidePage';

describe('GuideAiPrompt', () => {
  beforeEach(() => {
    installApiFixtures();
  });
  test('buildAiGuidePrompt formats prompt with given or default version and raw github link', () => {
    const withV = buildAiGuidePrompt('v1.2.3');
    expect(withV).toContain('I am using Aevra v1.2.3.');
    expect(withV).toContain('https://github.com/the-long-ride/aevra/blob/v1.2.3/llm.txt');
    expect(withV).toContain('https://github.com/the-long-ride/aevra/releases/tag/v1.2.3');
    expect(withV).toContain('https://github.com/the-long-ride/aevra/blob/main/llm.txt');
    expect(withV).toContain('https://github.com/the-long-ride/aevra/blob/main/CHANGELOG.md');
    expect(withV).toContain('Version-safety rules:');
    expect(withV).toContain('My installed version (v1.2.3) is authoritative.');
    expect(withV).toContain(
      'Do not ask me for passwords, tokens, cookies, backup secrets, or other credentials.',
    );
    expect(withV).toContain(
      'Once you have read and understood the documentation, reply to confirm that you are ready for my questions.',
    );

    const withoutV = buildAiGuidePrompt('1.1.0');
    expect(withoutV).toContain('I am using Aevra v1.1.0.');

    const undefinedVersion = buildAiGuidePrompt(undefined);
    expect(undefinedVersion).toContain('I am using Aevra v1.1.2.');
  });

  test('renders prompt with version and github links', () => {
    render(<GuideAiPrompt version="2.0.0" />);
    expect(
      screen.getByRole('heading', { name: /Chat with AI to learn Aevra/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can use this prompt with our/)).toBeInTheDocument();

    const rawLink = screen.getByRole('link', { name: 'llm.txt' });
    expect(rawLink).toHaveAttribute(
      'href',
      'https://raw.githubusercontent.com/the-long-ride/aevra/main/llm.txt',
    );

    const githubLink = screen.getByRole('link', { name: 'GitHub' });
    expect(githubLink).toHaveAttribute(
      'href',
      'https://github.com/the-long-ride/aevra/blob/main/llm.txt',
    );

    expect(screen.getByText(/I am using Aevra v2.0.0/)).toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: 'Copy prompt' });
    expect(copyButton).toHaveClass('primary');
  });

  test('copy button copies prompt to clipboard and updates label', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    render(<GuideAiPrompt version="1.1.0" />);
    const copyButton = screen.getByRole('button', { name: 'Copy prompt' });
    expect(copyButton).toHaveClass('primary');
    await user.click(copyButton);

    expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining('v1.1.0'));
    expect(await screen.findByText('Copied prompt!')).toBeInTheDocument();
  });

  test('copy button tolerates clipboard failure gracefully', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('clipboard blocked'));

    render(<GuideAiPrompt version="1.1.0" />);
    const copyButton = screen.getByRole('button', { name: 'Copy prompt' });
    await user.click(copyButton);
    expect(writeTextSpy).toHaveBeenCalled();
    // Remains 'Copy prompt' when clipboard fails
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument();
  });

  test('GuidePage renders GuideAiPrompt in quick-start chapter and hides it in other chapters', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/guide': [
          { slug: 'quick-start', title: 'Quick start', file: '00-quick-start.md' },
          { slug: 'install', title: 'Install', file: '01-install.md' },
        ],
        '/manual/00-quick-start.md': '# Quick start\n\nContent for quick start',
        '/manual/01-install.md': '# Install\n\nContent for install',
      },
    });

    render(<GuidePage />);

    expect(
      await screen.findByRole('heading', { name: /Chat with AI to learn Aevra/ }),
    ).toBeInTheDocument();

    const installButtons = screen.getAllByRole('button', { name: 'Install' });
    await user.click(installButtons[0]);

    expect(await screen.findByRole('heading', { name: 'Install' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Chat with AI to learn Aevra/ }),
    ).not.toBeInTheDocument();
  });
});
