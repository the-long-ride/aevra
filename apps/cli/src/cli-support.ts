export { completionText, usageText } from './cli-usage.js';

export function formatCliError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as Error & { code?: string }).code;
  if (code === 'ADMIN_CREDENTIALS_REQUIRED') {
    return [
      error.message,
      'Set both AEVRA_USERNAME and AEVRA_PASSWORD in the environment of the process that starts Aevra, then retry.',
    ].join('\n');
  }
  return error.message;
}

export const START_STOP_LINE = '[aevra] Press Ctrl+C to stop Aevra.';

function serviceTable(info: {
  adminUrl: string;
  mcpUrl: string;
  gatewayUrl?: string;
  desktopHelperReady: boolean;
}): string[] {
  const rows: Array<[string, string]> = [
    ['Service', 'Value'],
    ['Core', 'ready'],
    ['Desktop helper', info.desktopHelperReady ? 'ready' : 'missing'],
    ...(info.gatewayUrl ? ([['Gateway', info.gatewayUrl]] as Array<[string, string]>) : []),
    ['MCP', `${info.mcpUrl}/mcp`],
    ['Dashboard', info.adminUrl],
  ];
  const serviceWidth = Math.max(...rows.map(([service]) => service.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  const border = (left: string, middle: string, right: string) =>
    `${left}${'─'.repeat(serviceWidth + 2)}${middle}${'─'.repeat(valueWidth + 2)}${right}`;
  const row = (service: string, value: string) =>
    `│ ${service.padEnd(serviceWidth)} │ ${value.padEnd(valueWidth)} │`;

  return [
    border('┌', '┬', '┐'),
    row(...rows[0]!),
    border('├', '┼', '┤'),
    ...rows.slice(1).map(([service, value]) => row(service, value)),
    border('└', '┴', '┘'),
  ];
}

export function readyLines(info: {
  adminUrl: string;
  mcpUrl: string;
  gatewayUrl?: string;
  desktopHelperReady: boolean;
}): string[] {
  return [
    '',
    '               ',
    '                   ▄         ',
    ' ▄▀▀█▄ ▄█▀█▄▀█▄ ██▀████▄▄▀▀█▄',
    ' ▄█▀██ ██▄█▀ ██▄██ ██   ▄█▀██',
    '▄▀█▄██▄▀█▄▄▄  ▀█▀ ▄█▀  ▄▀█▄██',
    '',
    ...serviceTable(info),
    '',
  ];
}

export function cloudflareSetupNeedsAccess(value: string): boolean {
  return value.trim().toLowerCase() === 'access';
}
