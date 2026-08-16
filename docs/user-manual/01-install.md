# Install

## Requirements

- Node.js 22.5 or newer.
- `cloudflared` only for managed Cloudflare exposure.
- `ngrok` only for managed ngrok exposure.
- A trusted TLS certificate and key when using Direct HTTPS exposure.

## From a source checkout

```powershell
npm install
npm run build
npm link
```

Verify:

```powershell
aevra help
```

The global `aevra` command points at the linked checkout, so rebuild after source changes.

## Mandatory Admin credentials

Every `aevra start` requires both `AEVRA_USERNAME` and `AEVRA_PASSWORD`. They are read from the process environment, never written to Aevra configuration, and are used only to issue authenticated Web UI sessions.

Windows PowerShell:

```powershell
$env:AEVRA_USERNAME = 'admin'
$env:AEVRA_PASSWORD = '<choose-a-password>'
aevra start --ui
```

Linux or macOS shell:

```sh
export AEVRA_USERNAME='admin'
export AEVRA_PASSWORD='<choose-a-password>'
aevra start --ui
```

For a background service, configure the same variables in the service environment rather than putting credentials in command-line arguments.
