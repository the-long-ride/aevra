import {
  AUTHOR,
  AUTHOR_PROFILE_URL,
  ISSUES_URL,
  REPOSITORY_URL,
} from '../../../../packages/admin-contracts/src/about.js';
import { AEVRA_VERSION } from '../../../core/src/version.js';
import type { AevraCommand } from '../args.js';

type AboutCommand = Extract<AevraCommand, { command: 'about' }>;

export interface AboutDependencies {
  log(message: string): void;
}

export function formatAboutTable(rows: Array<[string, string]>): string[] {
  const col1Width = Math.max(...rows.map(([left]) => left.length));
  const col2Width = Math.max(...rows.map(([, right]) => right.length));
  const border = (left: string, mid: string, right: string) =>
    `${left}${'─'.repeat(col1Width + 2)}${mid}${'─'.repeat(col2Width + 2)}${right}`;
  const row = (left: string, right: string) =>
    `│ ${left.padEnd(col1Width)} │ ${right.padEnd(col2Width)} │`;

  return [
    border('┌', '┬', '┐'),
    row(rows[0]![0], rows[0]![1]),
    border('├', '┼', '┤'),
    ...rows.slice(1).map(([left, right]) => row(left, right)),
    border('└', '┴', '┘'),
  ];
}

export function formatAboutOutput(version: string = AEVRA_VERSION): string {
  const tableRows: Array<[string, string]> = [
    ['Property', 'Value'],
    ['Author', AUTHOR],
    ['GitHub Profile', AUTHOR_PROFILE_URL],
    ['GitHub Repository', REPOSITORY_URL],
    ['GitHub Issues', ISSUES_URL],
  ];

  return [
    `Aevra (v${version}) — Workspace-scoped local MCP execution gateway for AI web interfaces with policy controls, upstream bridging, human approvals, and audit recovery`,
    '',
    ...formatAboutTable(tableRows),
  ].join('\n');
}

export function runAboutCommand(
  _command: AboutCommand,
  dependencies: AboutDependencies = { log: console.log },
): number {
  dependencies.log(formatAboutOutput());
  return 0;
}
