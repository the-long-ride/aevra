export function usageText(): string {
  return [
    'Aevra — workspace-scoped local MCP execution gateway for AI web interfaces',
    '',
    'Usage: aevra <command> [options]',
    '',
    'Run:',
    '  aevra start [--ui] [--basePort <n> | <individual port options>]',
    '  aevra ui [--logout-all]',
    '  aevra setup',
    '  aevra service install|start|stop|restart|status',
    '    install/start/restart accept the same port options as start',
    '  aevra status [--json]',
    '',
    'Startup ports (use --flag=value or --flag value):',
    '  --basePort <n>         gateway n, UI n+1, MCP n+2, WebSocket n+3 (1..65532)',
    '  --gateway-port, --gp   gateway port (default 47830)',
    '  --ui-port, --up        UI/admin and extension pairing port (default 47831)',
    '  --mcp-port, --mp       internal MCP port (default 47832)',
    '  --ws-port, --wp        extension WebSocket port (default 47833)',
    '  Individual ports: 1..65535, distinct; cannot be combined with --basePort.',
    '',
    'Connect:',
    '  aevra agent list|install|uninstall|status  connect local AI agents (aevra agent --help)',
    '  aevra connectors list|create <name>|revoke <id>',
    '  aevra connections list|revoke <id>',
    '  aevra mcp list|add <name> --transport …|remove <id>|test <id>|enable <id>|disable <id>|review <id>|accept <id> [--yes]',
    '  aevra extension install [--dir <path>] [--yes]',
    '',
    'Maintain:',
    '  aevra sessions list|revoke <id>',
    '  aevra sessions revoke-others --yes',
    '  aevra audit clear --yes',
    '  aevra backup verify <file>|restore <file> [--yes]',
    '  aevra uninstall [--purge] [--dry-run]  remove agent links; --purge also removes service and state',
    '  aevra completion bash|zsh|powershell',
    '  aevra about',
    '  aevra --version',
    '  aevra --help',
    '',
    'KDE KWin 6.6: build/enable the bundled native companion and create its private helper-path grant; reconnect.',
    'GNOME Wayland: install/enable the bundled Aevra Desktop Access companion,',
    'allow access and approve the helper path from its panel menu, then reconnect.',
  ].join('\n');
}

export function agentHelpText(): string {
  return [
    'Usage: aevra agent <command> [options]',
    '',
    'Connect local AI agents (Codex, Claude Code, OpenCode, Antigravity) to Aevra.',
    '',
    'Commands:',
    '  aevra agent list [--json]                         show detected agents and their connections',
    '  aevra agent status [--json]                       same as list',
    '  aevra agent install [<agent>...|all] [options]    connect agents',
    '  aevra agent uninstall <agent>...|all [options]    remove connections',
    '  aevra agent uninstall --id <id> [--dry-run]       remove one connection by its id (see list)',
    '  aevra agent serve --credential-file <file>        internal: the stdio bridge that generated configs start',
    '',
    'Agents:',
    '  codex, claude-code, opencode, antigravity',
    '  claude (alias for claude-code)',
    '',
    'Options:',
    '  --scope user|workspace   user (default) covers all your projects; workspace covers one Aevra workspace',
    '  --workspace <name|id>    registered workspace to use; implies --scope workspace (install and uninstall)',
    '  --id <id>                uninstall only: the connection id shown by list for a workspace that is gone',
    '  --transport stdio|http   install only; stdio is the default; http cannot be used with workspace scope',
    '  --dry-run                show what would change; nothing is written and it never prompts',
    '  --yes                    install only: skip the "Proceed? [y/N]" prompt',
    '  --json                   print JSON instead of text',
    '',
    'Behaviour:',
    '  install with no agent names acts on the agents found on this machine, lists them and asks',
    '  "Proceed? [y/N]"; --yes skips the prompt, and a run without a terminal and without --yes exits 1.',
    '  all means every detected agent for install and every connected agent for uninstall.',
    '  Naming an agent installs it even if it was not detected.',
    '  Several agents run independently; the exit code is 1 if any of them fails.',
    '  Workspace scope uses stdio only, installs no skill, and needs a workspace with a local folder.',
    '  uninstall <agent> without --scope removes the global connection; uninstall all without',
    '  --scope removes every connection, global and workspace; with --scope user only global ones.',
    '  uninstall --id removes one connection even when its folder was deleted or is no longer a',
    '  registered workspace; list prints the id of such connections.',
    '  Giving --workspace to uninstall without --scope means that workspace, so only its',
    '  connection is removed.',
    '',
    'Examples:',
    '  aevra agent list',
    '  aevra agent install',
    '  aevra agent install codex claude --yes',
    '  aevra agent install codex claude --workspace Demo',
    '  aevra agent install all --dry-run',
    '  aevra agent uninstall codex --workspace Demo',
    '  aevra agent uninstall all',
    '  aevra agent uninstall --id 3f2a',
  ].join('\n');
}

const COMMANDS = [
  'start',
  'ui',
  'setup',
  'service',
  'status',
  'agent',
  'connectors',
  'connections',
  'mcp',
  'extension',
  'sessions',
  'audit',
  'backup',
  'uninstall',
  'completion',
  'about',
  '--version',
  '-v',
  '--help',
  '-h',
];

const AGENT_WORDS = [
  'list',
  'install',
  'uninstall',
  'status',
  'codex',
  'claude',
  'claude-code',
  'opencode',
  'antigravity',
  'all',
  '--scope',
  '--workspace',
  '--id',
  '--transport',
  '--dry-run',
  '--yes',
  '--json',
  '--help',
];

export function completionText(shell: 'bash' | 'zsh' | 'powershell'): string {
  const commands = COMMANDS.join(' ');
  const agent = AGENT_WORDS.join(' ');

  if (shell === 'bash') {
    return `_aevra() {
  local cur
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "\${COMP_WORDS[1]}" == "start" && $COMP_CWORD -ge 2 ]]; then
    COMPREPLY=( $(compgen -W "--ui --basePort --gateway-port --gp --ui-port --up --mcp-port --mp --ws-port --wp" -- "$cur") )
    return
  fi
  if [[ "\${COMP_WORDS[1]}" == "agent" && $COMP_CWORD -ge 2 ]]; then
    COMPREPLY=( $(compgen -W "${agent}" -- "$cur") )
    return
  fi
  COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )
}
complete -F _aevra aevra
`;
  }

  if (shell === 'zsh') {
    return `#compdef aevra
_aevra() {
  if (( CURRENT >= 3 )) && [[ $words[2] == start ]]; then
    _values 'start options' \\
      '--ui[open authenticated React dashboard when ready]' \\
      '--basePort[start of the four-port listener block]' \\
      '--gateway-port[gateway port]' '--gp[gateway port]' \\
      '--ui-port[UI/admin port]' '--up[UI/admin port]' \\
      '--mcp-port[MCP port]' '--mp[MCP port]' \\
      '--ws-port[extension WebSocket port]' '--wp[extension WebSocket port]'
    return
  fi
  if (( CURRENT >= 3 )) && [[ $words[2] == agent ]]; then
    _values 'agent options' ${agent}
    return
  fi
  _arguments '1:command:(${commands})'
}
_aevra "$@"
`;
  }

  const quoted = (words: string) =>
    words
      .split(' ')
      .map((word) => `'${word}'`)
      .join(',');
  return `Register-ArgumentCompleter -CommandName aevra -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = $commandAst.CommandElements
  if ($elements.Count -ge 2 -and $elements[1].Value -eq 'start') {
    @('--ui','--basePort','--gateway-port','--gp','--ui-port','--up','--mcp-port','--mp','--ws-port','--wp') | Where-Object { $_ -like "$wordToComplete*" }
    return
  }
  if ($elements.Count -ge 2 -and $elements[1].Value -eq 'agent') {
    @(${quoted(agent)}) | Where-Object { $_ -like "$wordToComplete*" }
    return
  }
  @(${quoted(commands)}) | Where-Object { $_ -like "$wordToComplete*" }
}
`;
}
