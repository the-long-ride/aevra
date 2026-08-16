# Aevra Installation & Development Guideline

This document contains comprehensive instructions for building, installing from source, configuring as a service, developing, testing, and troubleshooting Aevra.

---

## 1. Prerequisites & System Requirements

- **Node.js**: `22.5.0` or higher (`node -v`)
- **npm**: `10.8.0` or higher
- **Git**: Installed and available in PATH (for git tools)
- **Exposure Tunnel (optional)**: `cloudflared`, `caddy`, `tailscale`, `frp`, or `ngrok` for remote connectivity
- **Sandboxing (optional)**: Docker or Podman for containerized command isolation; host fallback is policy-gated

---

## 2. Installation from Source

Clone the repository and build the distribution binaries:

```bash
# Clone the repository
git clone https://github.com/the-long-ride/aevra.git
cd aevra

# Install dependencies for root workspace and web dashboard
npm install

# Build CLI and React web dashboard
npm run build

# Link CLI globally for current user
npm link
```

After linking, the `aevra` binary will be available globally in your terminal.

---

## 3. Configuration & Startup

### Environment Variables

Before starting Aevra Core, configure the mandatory admin credentials:

```bash
# Linux / macOS (session or add to ~/.bashrc / ~/.zshrc)
export AEVRA_USERNAME="admin"
export AEVRA_PASSWORD="YourSecurePassword"

# Windows (PowerShell - User Scope)
[System.Environment]::SetEnvironmentVariable('AEVRA_USERNAME', 'admin', 'User')
[System.Environment]::SetEnvironmentVariable('AEVRA_PASSWORD', 'YourSecurePassword', 'User')

# Windows (CMD - User Scope)
setx AEVRA_USERNAME "admin"
setx AEVRA_PASSWORD "YourSecurePassword"
```

### Optional Configuration Variables

| Variable            | Default                 | Purpose                                                              |
| ------------------- | ----------------------- | -------------------------------------------------------------------- |
| `AEVRA_PUBLIC_PORT` | `47830`                 | Public HTTPS Gateway port (direct HTTPS / reverse proxy destination) |
| `AEVRA_ADMIN_PORT`  | `47831`                 | Localhost-only Admin API and React Web UI port                       |
| `AEVRA_MCP_PORT`    | `47832`                 | Localhost-only MCP data plane JSON-RPC port                          |
| `AEVRA_STATE_DIR`   | Platform default        | Override path for database, secrets vault, and logs                  |
| `AEVRA_TLS_CERT`    | Auto-generated cert PEM | Custom TLS certificate for HTTPS listeners                           |
| `AEVRA_TLS_KEY`     | Auto-generated key PEM  | Custom TLS private key                                               |

### Starting the Server

```bash
# Start daemon in foreground
aevra start

# Start daemon and automatically open authenticated browser dashboard
aevra start --ui
```

---

## 4. Connecting AI Clients (ChatGPT, Claude.ai & Custom MCP Clients)

Aevra exposes a standard MCP endpoint (`/mcp`) that can be accessed either **directly over HTTPS** on your host/local network (`https://<host>:47830/mcp`) or **exposed to the internet through a tunnel** (Cloudflare Tunnel, ngrok, Tailscale Funnel, Caddy, FRP, reverse SSH).

### Connecting ChatGPT (Custom Plugin / Action)

1. In ChatGPT, open the Custom Actions / Plugins builder:
   - **Name**: `Aevra` (or any custom label)
   - **Server URL**: `https://<your-aevra-host>/mcp` (your public tunnel or reachable HTTPS endpoint)
   - **Authentication**: `OAuth`
2. ChatGPT discovers the OAuth 2.0 PKCE endpoints on Aevra and prompts for authorization.
3. Open your local Aevra Web UI (`https://localhost:47831`), review the pairing code and actor details, and click **Allow**.
4. In ChatGPT plugin / action settings, grant **Permission for Plugins -> Allow all actions** so tool calls execute automatically without recurring client-side confirmation prompts.

### Connecting Claude.ai & Other MCP Clients (Custom Connector)

1. Open the local Aevra Web UI at `https://localhost:47831` and go to **Connectors**.
2. Click **Create Connector**, enter a name (e.g. `Claude.ai` or `Cursor`), and copy the generated token or connector URL.
3. In Claude.ai or your client settings, add a Custom Connector / MCP Server:
   - **Name**: `Aevra`
   - **Server URL**: `https://<your-aevra-host>/mcp/<token>` (or `https://<your-aevra-host>/mcp` with `Authorization: Bearer <token>`)

---

## 5. Running as a Background Service

Aevra provides native, non-root user service integration across Windows, Linux, and macOS:

```bash
# Install user-scoped service
aevra service install

# Start background service
aevra service start

# Check service status
aevra service status

# Restart or stop
aevra service restart
aevra service stop
```

### OS Implementation Details

- **Windows**: Configures a current-user Scheduled Task triggered at user logon (no elevation required).
- **Linux**: Installs and manages a `systemd --user` unit service.
- **macOS**: Registers a LaunchAgent in `~/Library/LaunchAgents/com.aevra.daemon.plist`.

---

## 6. Development & Testing Workflow

### Project Architecture & Boundaries

The codebase enforces strict isolation boundaries checked by automated tests:

1. **Core Gateway (`apps/core`)**: Handles admission, sessions, leases, capability profiles, risk assessment, human approvals, and audit logging. Core authorizes operations but never executes commands directly.
2. **Worker & Executor (`apps/worker`, `packages/executor`)**: Out-of-process execution worker receiving exact authority over local IPC. Worker never accesses Core store or policy state.
3. **MCP Tools (`packages/mcp-tools`)**: Implements standard MCP 2.0 tool handlers without importing Worker executor internals directly.
4. **Web UI (`apps/web-react`)**: React 19 single-page application communicating exclusively with the Admin REST API.
5. **Store & Security (`packages/store`, `packages/security`)**: SQLite persistence (`node:sqlite`), encryption vaults, DLP redaction, and `SecurityGuard` data boundaries.

### Quality Gate Commands

Run the full quality gate or individual check suites during development:

```bash
# Run complete verification gate (format, lint, typecheck, tests, coverage, UI parity)
npm run test:gate

# Type checking (TypeScript strict mode)
npm run typecheck

# Linting (source lint, line-count lint, dead-code detection via Knip)
npm run lint

# Code formatting checks
npm run format:check

# Auto-format all code
npm run format

# Run test suites
npm run test:unit            # Fast unit tests
npm run test:contract        # IPC & tool contract tests
npm run test:integration     # Multi-component integration tests
npm run test:security        # Security boundary, DLP, and path-traversal tests
npm run test:web             # React Web UI Vitest suite
npm run test:coverage        # V8 coverage report (enforces >= 85% floor)
npm run test:ui-parity       # Playwright browser UI parity tests
```

---

## 7. Default State & Directory Locations

| Platform | Default State Directory                           |
| -------- | ------------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\Aevra`                            |
| macOS    | `~/Library/Application Support/Aevra`             |
| Linux    | `$XDG_STATE_HOME/aevra` or `~/.local/state/aevra` |

The state folder stores:

- `aevra.db`: SQLite database (WAL mode, schema versioned)
- `local-control.secret`: Localhost authentication control token
- `secrets.vault`: AES-256-GCM encrypted fallback secret store
- `recovery/`: Journaled change set before-snapshots
- `backups/`: Consistent database backups (`VACUUM INTO`)

---

## 8. Troubleshooting Common Issues

| Issue / Error Code           | Cause                                                        | Solution                                                                                        |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `401 unauthorized` on `/mcp` | Connection missing valid OAuth or Bearer token               | Authorize via OAuth dialog or pass valid `Authorization: Bearer <token>` connector header.      |
| `ADMIN_CREDENTIALS_REQUIRED` | `AEVRA_USERNAME` or `AEVRA_PASSWORD` not set at startup      | Export both environment variables before launching `aevra start`.                               |
| `SESSION_WORKSPACE_REQUIRED` | Client connected but has not selected an admitted workspace  | Call `workspace_select` with a registered workspace ID or name.                                 |
| `CAPABILITY_REQUIRED`        | Current capability profile or lease denies the operation     | Upgrade workspace profile in Admin UI or approve step-up permission in Requests.                |
| `APPROVAL_PENDING`           | High-risk or sensitive operation requires local confirmation | Open `aevra ui`, click Allow on the request ticket, then call `approval_wait`.                  |
| `APPROVAL_CONTEXT_CHANGED`   | State changed while approval was pending                     | Re-issue the tool call against the current repository / workspace state.                        |
| `WORKSPACE_ESCAPE`           | Path attempts traversal outside registered capability root   | Ensure files and links resolve inside workspace boundaries or configure an external mount.      |
| `EXECUTOR_UNAVAILABLE`       | Docker/Podman container sandbox backend unavailable          | Start Docker/Podman or explicitly configure host execution permission in workspace settings.    |
| `MERGE_CONFLICT`             | Concurrent conflicting writes on overlapping lines           | Aevra wrote nothing; re-read latest content via `file_read` and apply resolved patch.           |
| `SAFE_MODE`                  | Database integrity check failed on startup                   | Admin UI remains open in read-only diagnostic mode to export data and restore database backups. |
