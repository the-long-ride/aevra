# Local AI agents and the shared browser extension

Start Aevra normally, then connect Codex, Claude Code, OpenCode or Antigravity.
Use a persistent npm installation: generated stdio commands refer to the
installed Node executable and CLI entrypoint.

```sh
aevra agent list
aevra agent install
aevra agent install codex claude --yes
aevra agent install codex claude --workspace Demo
aevra agent install all --transport stdio
aevra agent install claude-code --transport http --dry-run
aevra agent list --json
aevra agent uninstall codex
aevra agent uninstall codex --workspace Demo
aevra agent uninstall --id <id>
```

The Settings page offers the same controls (see "Settings page" below). By
default a connection is global (user scope): it adds a distinct `aevra` MCP entry
and a connector credential for each target. A connection can also be limited to
one registered Aevra workspace (workspace scope, see below). The standalone
Browser package uses `aevra-browser agent ...`, distinct `aevra-browser` entries
and independent credentials. Both products can be installed in the same agent
profile.

Skills have one canonical copy at `~/.agents/skills/aevra` and
`~/.agents/skills/aevra-browser`. Codex discovers that directory directly.
Claude Code, OpenCode and Antigravity receive symbolic directory links
(directory junctions on Windows). Existing unmanaged entries, modified skills,
malformed config or conflicting links are retained with a conflict message.
Refresh or restart the agent after changing an integration.

Configuration uses each agent's native format: Codex TOML, Claude Code JSON,
OpenCode JSON/JSONC and Antigravity MCP JSON. `CODEX_HOME`,
`CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME` and `OPENCODE_CONFIG` are respected where
applicable. Antigravity prefers `~/.gemini/config/mcp_config.json`; an existing
legacy `~/.gemini/antigravity/mcp_config.json` is supported. If both exist,
resolve the ambiguity before installing. Antigravity skill links cover the
selected app folder and its CLI global skills folder.

## Commands

`aevra agent list` (alias `aevra agent status`) shows each agent, whether it was
found on this machine, the scope of its connection (`global` or the workspace
name), the transport, the state and when the connection was last used. Add
`--json` for a single JSON document on stdout.

`aevra agent install [<agent>...|all]` and `aevra agent uninstall <agent>...|all`
connect and disconnect agents. Agent names are `codex`, `claude-code`, `opencode`
and `antigravity`; `claude` is an alias for `claude-code`.

- With no agent names, `install` acts on the agents detected on this machine,
  prints the list and asks `Proceed? [y/N]`. `--yes` skips the question. Without
  a terminal and without `--yes` it prints the list and exits with code 1.
  `--dry-run` never prompts.
- `all` means every detected agent for `install` (naming `all` is consent, so it
  does not prompt) and every connected agent for `uninstall`. If nothing is
  detected, `install all` exits with code 1.
- Naming an agent installs it even if detection did not find it.
- Several agents run independently. If one fails the others stay installed and
  the exit code is 1.
- `--scope user|workspace` chooses between a global connection (default) and a
  workspace connection. `--workspace <name|id>` selects the workspace, implies
  `--scope workspace` and is resolved through the registered Aevra workspaces.
- `--transport stdio|http` applies to `install` only. `--dry-run` shows what would
  change and writes nothing. `--json` prints JSON instead of text; credential file
  paths and hashes are never printed.
- `uninstall <agent>` without `--scope` removes the global connection.
  `uninstall all` without `--scope` removes every connection, global and
  workspace; `uninstall all --scope user` removes only global connections and
  never touches workspace ones. Each agent is removed independently: if one
  fails (for example its entry was changed by hand), the others are still
  removed and the exit code is 1. Giving `--workspace` to `uninstall` without
  `--scope` means that workspace, so only its connection is removed.
- `uninstall --id <id>` removes exactly one connection, chosen by its connection
  id, even when its workspace folder was deleted or is no longer a registered
  Aevra workspace. It cannot be combined with agent names, `all`, `--scope` or
  `--workspace`. `aevra agent list` prints the id of such connections (other
  rows never show it). If the folder is gone, the registration is removed and
  its credential revoked, and a note says that the entry file could not be
  edited.
- Uninstall saves every configuration edit and the connection record first and revokes the credential last. If the revoke fails, the files stay as saved and the command fails with `AGENT_REVOKE_INCOMPLETE` naming the credential ids that are still valid; nothing uses them any more, but revoke them by hand. A failure of the git exclude cleanup or of the file cleanup after the save is reported as a note and never undoes the uninstall.

Detection looks for the agent's command name on `PATH` or for its configuration
home (`~/.codex` or `CODEX_HOME`, `~/.claude.json` or `~/.claude`,
`~/.config/opencode`, `~/.gemini`). It never starts any agent process.

## Workspace scope

Workspace scope connects an agent to one registered Aevra workspace instead of
every project. It needs a workspace with a local folder, uses stdio only (HTTP is
refused), installs no skill and creates no skill links. The entry is written to a
file that belongs to that project:

| Agent       | Where the entry goes                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Codex       | `<root>/.codex/config.toml` (Codex reads it for trusted projects only)                              |
| Claude Code | `~/.claude.json` under `projects[<root>]` (local scope); nothing is written into the project folder |
| OpenCode    | `<root>/opencode.json`, or an existing `<root>/opencode.jsonc`                                      |
| Antigravity | `<root>/.agents/mcp_config.json`                                                                    |

For Codex, OpenCode and Antigravity the entry file lives inside the project, so
the installer protects the repository: if git already tracks the file, the
install is refused with `AGENT_PROJECT_FILE_TRACKED` and nothing is written;
otherwise the file is added to the repository's `info/exclude` so it is not
committed by accident. If git is missing or the folder is not a repository, the
exclude step is skipped. git is started only from an absolute path found on
`PATH` outside the project folder (device paths such as `\\?\...` and 8.3 short
names of the project folder are recognised); a `git` program inside the project
is never run, and a git found only inside the project counts as missing. When
the folder (or a folder above it) holds `.git` but no usable git was found
outside the project, the install still goes ahead and adds the note `git could
not be found outside the project folder <root>, so git tracking was not
checked.` Check by hand that the entry file is not tracked. Claude Code writes only to its user file (`~/.claude.json`, or
`$CLAUDE_CONFIG_DIR/.claude.json` when `CLAUDE_CONFIG_DIR` is set), reusing an
existing `projects` key for that folder if one is already there.

A workspace connection is also refused, before anything is written and for
`--dry-run` and Preview too, when:

- the entry file, or any folder on the way to it inside the project, is a
  symbolic link or directory junction (for example a `.codex` link to
  `~/.codex`): `AGENT_PATH_CONFLICT`;
- the workspace folder is your home folder or a filesystem root, or the project
  file would be the agent's own global file (for example `CODEX_HOME` pointing
  into the project): `AGENT_OPTIONS_INVALID`. Use a global connection instead.

The link refusal also applies to uninstall and status (status shows
`conflict`), including a connection installed by an older build while the link
was in place. Remove the link (for example delete the `<root>/.codex` link, not
its target), run the uninstall again, then delete the leftover `aevra` entry by
hand in the file the link pointed to (for example `mcp_servers.aevra` in
`~/.codex/config.toml`); otherwise a later global install of that agent is
refused with `AGENT_CONFIG_CONFLICT`.

Notes after installing:

- Codex loads project configuration only for trusted projects. Trust the folder in
  Codex; Aevra cannot detect trust.
- For Claude Code, start Claude Code in that folder once so it recognises the
  project, then restart it so it picks up the connection.

## Settings page

The agent section of Settings shows a table of connections: Agent, Scope (Global or
the workspace name), Transport, Config file, State, Last used and row actions
(Update, Remove). Rescan reloads detection and connections.

Connect opens a dialog (Connect an AI agent):

1. The detected agents are pre-selected. An agent that was not found can be
   enabled with `Install anyway`.
2. Choose `Global (all my projects)` or `Only these workspaces` and switch on
   one or more workspaces. For workspace scope HTTP is disabled (stdio only), no
   skill is installed, and a Codex trust note is shown. The install runs once per
   selected workspace; a failure in one workspace does not stop the others.
3. Preview runs a dry run and lists, in a two-column table (AI agent, Path), the
   files that would be created, updated or removed, plus notes and any per-agent
   problem.
4. Install applies the change and shows a result per agent. If some agents fail,
   the dialog stays open, the agents that succeeded are marked `Installed` and
   the failed ones stay selected so they can be retried.

A workspace connection whose folder is not a registered Aevra workspace (or was
deleted) is shown with Update disabled. Its Remove button removes that one
connection by its connection id, as `aevra agent uninstall --id <id>` does; no
other connection is touched.

Remove asks for confirmation first. A connection whose credential was deleted shows `Credential missing` in Last used (the CLI list shows `missing`) and has the state `incomplete`; `Never used` only appears for a credential that exists and has not been used yet.

## HTTP and stdio

The managed root stdio command is:

```sh
aevra agent serve --credential-file <managed-file>
```

`aevra agent serve` replaces the former `aevra mcp serve --stdio` and there is no
alias. Configurations written by earlier local builds still point at the old
command. Run `aevra agent install <agent>` again with the same scope (or use
Update in Settings): when a connection exists and its entry differs from the one
that would be written now (old command, moved Node executable or CLI
entrypoint), the entry is rewritten in place and keeps its credential. The same
holds after the MCP port or the TLS CA file changed: the stdio credential file is
rewritten with the current endpoint and CA file (same id and token; a note says
`credential file refreshed`), and an HTTP entry with an old endpoint is rewritten
with the stored credential (no new credential is issued). An identical
connection is reported as `no change`. A change of transport replaces the
connection and its credential.

The installer supplies the protected credential reference. This bridge connects
to the existing core; start `aevra start` or the user service first. It does not
create another core. Root policies, workspace authorization, host-control grants,
approvals, audit and safe mode continue to apply. stdout contains only MCP
JSON-RPC; diagnostics use stderr. Managed local TLS trust is preserved.

Standalone Browser keeps `aevra-browser mcp`, which starts its shared daemon on
demand. Its managed registrations use independently revocable credentials.
Browser HTTP credentials survive daemon restarts and cannot call management
routes. They share the Browser daemon's existing browser authority.

`--transport http` writes the agent's native HTTP configuration. Root's local
HTTPS certificate must be trusted by the HTTP agent. Choose stdio when the
agent's HTTP TLS trust cannot use that certificate. HTTP authorization headers
are credentials: protect agent configuration files and do not paste them into
logs or chat. HTTP is available for global connections only.

## One extension, selected by pairing port

Both packages consume the same extension source. Load one copy and keep its
directory stable. In the popup, enter a fresh pairing code and the desired
product's **pairing port**:

| Product       | Pairing port | MCP port | Extension WebSocket port |
| ------------- | ------------ | -------- | ------------------------ |
| Aevra         | 47831        | 47832    | 47833                    |
| Aevra Browser | 47841        | 47842    | 47843                    |

These are defaults. `aevra start --ui --basePort=50000` uses pairing `50001`,
MCP `50002`, and WebSocket `50003`. `aevra-browser serve --basePort=50100` uses
pairing `50100`, MCP `50101`, and WebSocket `50102`. Individual listener flags also
work. Root CLI agent installation discovers the running core's actual endpoints
from its state directory. Reinstall existing HTTP/stdio registrations after a
root endpoint change to refresh the stored endpoint and CA information.

Custom configured ports work too. Successful pairing switches the active server;
failed pairing preserves the previous connection. Both servers may run, but the
extension connects to one at a time. Saved credentials, authenticated connection
and attached browser target remain separate states.

Both extension installers select a shared stable default location under
`~/.agents/aevra/browser`. A known legacy installation can retain its path.
Explicit `--dir` remains available; do not move a loaded unpacked extension.
The shared source snapshot is refreshed with
`node scripts/export-browser-shared.mjs --target=<browser-repository>` and checked
with the same command plus `--check`.

## Removal

```sh
aevra agent uninstall all
aevra uninstall --dry-run
aevra uninstall
aevra uninstall --purge
aevra-browser uninstall --purge
```

Default removal unlinks managed agent integrations and revokes their credentials.
`aevra uninstall` prints a short summary of what it removed and runs the product
cleanup only after the agent removal succeeded. `--purge` also stops the product
and removes its service/owned application state and its last-owned extension
files. Shared extension files remain while the other product owns them. A
managed entry, credential file or skill that changed since Aevra wrote it is never
overwritten: the uninstall of that agent is refused with a conflict message and
nothing of it is removed (other agents are still removed), and `aevra uninstall`
then skips its cleanup and `--purge`. Restore or
remove the changed item and run it again. An `aevra` entry that Aevra never
registered (for example one added by hand) is left untouched and does not block
the uninstall. Purge refuses unowned state directories, repository roots, home directories and linked
directory trees.

Remove the load-unpacked extension registration through `chrome://extensions`
or `edge://extensions` when it is no longer needed. Package binaries are removed
with the package manager; no npm lifecycle hook deletes user data.
