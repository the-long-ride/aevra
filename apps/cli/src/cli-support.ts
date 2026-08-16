export function usageText(): string {
  return [
    'Aevra — workspace-scoped local MCP execution gateway for AI web interfaces',
    '',
    'Usage:',
    '  aevra start [--ui]',
    '  aevra ui [--logout-all]',
    '  aevra setup',
    '  aevra service install|start|stop|restart|status',
    '  aevra connectors list|create <name>|revoke <id>',
    '  aevra sessions revoke-others --yes',
    '  aevra audit clear --yes',
    '  aevra status [--json]',
    '  aevra backup verify <file>|restore <file> [--yes]',
    '  aevra completion bash|zsh|powershell',
    '  aevra --help',
  ].join('\n');
}

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

export function readyLines(info: { adminUrl: string; mcpUrl: string }): string[] {
  return [
    '',
    '               ',
    '                   ▄         ',
    ' ▄▀▀█▄ ▄█▀█▄▀█▄ ██▀████▄▄▀▀█▄',
    ' ▄█▀██ ██▄█▀ ██▄██ ██   ▄█▀██',
    '▄▀█▄██▄▀█▄▄▄  ▀█▀ ▄█▀  ▄▀█▄██',
    '',
    '[aevra] Core: ready',
    `[aevra] MCP: ${info.mcpUrl}/mcp`,
    `[aevra] Dashboard: ${info.adminUrl}`,
    '[aevra] Press Ctrl+C to stop Aevra.',
  ];
}

export function completionText(shell: 'bash' | 'zsh' | 'powershell'): string {
  const commands = [
    'start',
    'ui',
    'setup',
    'service',
    'connectors',
    'sessions',
    'audit',
    'status',
    'backup',
    'completion',
    '--help',
  ];
  const startOptions = '--ui';

  if (shell === 'bash') {
    return `_aevra() {
  local cur
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "\${COMP_WORDS[1]}" == "start" && $COMP_CWORD -ge 2 ]]; then
    COMPREPLY=( $(compgen -W "${startOptions}" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -W "${commands.join(' ')}" -- "$cur") )
}
complete -F _aevra aevra
`;
  }

  if (shell === 'zsh') {
    return `#compdef aevra
_aevra() {
  if (( CURRENT >= 3 )) && [[ $words[2] == start ]]; then
    _values 'start options' \
      '--ui[open authenticated React dashboard when ready]'
    return
  fi
  _arguments '1:command:(${commands.join(' ')})'
}
_aevra "$@"
`;
  }

  return `Register-ArgumentCompleter -CommandName aevra -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = $commandAst.CommandElements
  if ($elements.Count -ge 2 -and $elements[1].Value -eq 'start') {
    @('--ui') | Where-Object { $_ -like "$wordToComplete*" }
    return
  }
  @('start','ui','setup','service','connectors','sessions','audit','status','backup','completion') | Where-Object { $_ -like "$wordToComplete*" }
}
`;
}

export function cloudflareSetupNeedsAccess(value: string): boolean {
  return value.trim().toLowerCase() === 'access';
}
