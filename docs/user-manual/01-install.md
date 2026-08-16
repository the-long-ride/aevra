# Install

## Requirements

- Node.js 22.5 or newer.
- `cloudflared` only when remote access is needed.

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
