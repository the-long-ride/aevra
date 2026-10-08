# Install

## Requirements

- Node.js 22.5 or newer.
- `cloudflared` only for managed Cloudflare exposure.
- `ngrok` only for managed ngrok exposure.
- A trusted TLS certificate and key when using Direct HTTPS exposure.

## From a source checkout

Install Node.js and a Rust toolchain (including `cargo`) to build the native desktop helper locally. From the repository root:

```powershell
npm install
npm run build:local
npm link
```

`npm run build:local` runs the JavaScript/web build and then compiles the native helper into `helper/target/release/`. For JavaScript-only development, `npm run build` is still available, but it does **not** build the desktop helper. `npm link` only links the checkout; it does not build the helper either.

The published npm package contains precompiled desktop helpers for its supported platforms, so users installing from npm do not need Cargo.

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
