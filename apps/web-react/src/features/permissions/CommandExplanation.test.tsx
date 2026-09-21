import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandExplanation } from './CommandExplanation';

describe('CommandExplanation', () => {
  it('renders null when analysis is missing', () => {
    const { container } = render(<CommandExplanation analysis={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders full outside analysis with wrappers, modifiers, cwd, targets and reasons', () => {
    const analysis: any = {
      scope: 'outside',
      nodes: [
        {
          id: 'n1',
          application: 'npm',
          operation: ['run', 'build'],
          scriptName: 'build',
          wrappers: [{ app: 'sudo' }],
          modifiers: ['force'],
          cwdCandidates: ['/tmp/project'],
          targets: [
            { path: '/etc/passwd', access: 'read', scope: 'outside' },
            { path: '/tmp/project/file', access: 'write', scope: 'inside' },
          ],
        },
      ],
      reasons: [{ code: 'OUTSIDE_TARGET', message: 'Target is outside workspace' }],
    };

    render(<CommandExplanation analysis={analysis} />);

    expect(screen.getByText('Command Understanding')).toBeInTheDocument();
    expect(screen.getByText('outside')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.getByText(/wrapped by sudo/)).toBeInTheDocument();
    expect(screen.getByText('run build')).toBeInTheDocument();
    expect(screen.getByText('[script: build]')).toBeInTheDocument();
    expect(screen.getByText('force')).toBeInTheDocument();
    expect(screen.getByText('/tmp/project')).toBeInTheDocument();
    expect(screen.getByText('/etc/passwd')).toBeInTheDocument();
    expect(screen.getByText(/Target is outside workspace/)).toBeInTheDocument();
  });

  it('renders unknown analysis without optional fields', () => {
    const analysis: any = {
      scope: 'unknown',
      nodes: [
        {
          id: 'n2',
          application: 'curl',
          operation: ['https://example.com'],
          wrappers: [],
          modifiers: [],
          cwdCandidates: [],
          targets: [],
        },
      ],
      reasons: [],
    };

    render(<CommandExplanation analysis={analysis} />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('curl')).toBeInTheDocument();
    expect(screen.queryByText(/wrapped by/)).not.toBeInTheDocument();
    expect(screen.queryByText('Outside Workspace Targets:')).not.toBeInTheDocument();
  });

  it('renders inside analysis with empty nodes', () => {
    const analysis: any = {
      scope: 'inside',
      nodes: [],
      reasons: [],
    };

    render(<CommandExplanation analysis={analysis} />);
    expect(screen.getByText('inside')).toBeInTheDocument();
    expect(screen.queryByText('Application:')).not.toBeInTheDocument();
  });
});
