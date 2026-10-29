# File transfer

Two tools let an AI client move real files, not only text: `files_download` (the agent sends files to this device) and `files_upload` (the agent pulls files from this device). Both take one to 64 files per call, of any type (images, PDF, docx, pptx, `.blend` and so on). Every file in a batch succeeds or fails on its own.

## Approvals

Each batch asks for **one** approval that lists every file with its path, source (inline or the host name) and size. For downloads it also shows the hosts the device will contact and how many headers the agent supplied, never the header values. The approval is HIGH risk and once-scoped, so it cannot become an always-allow. When YOLO risk is `Do whatever` no approval is asked. Secret and protected paths are refused for every file in every mode.

## Sending files to this device (`files_download`)

- A file comes from inline base64 or from a public `url` (optionally with headers such as a bearer token). Inline data is bounded by the inline limit; URL downloads stream to disk, so memory stays flat.
- URLs must be public http(s) addresses. Loopback, private, link-local, CGNAT and cloud metadata addresses are refused after DNS resolution and again on every redirect (at most 5).
- An existing target is not replaced unless the agent sets `overwrite`. Overwritten files up to 20 MiB are snapshotted for recovery; larger ones are not and the result says `recoverable: false`.
- If the declared `mimeType` disagrees with the content, the file is still written and the entry reports `mimeMismatch`.

## Getting files from this device (`files_upload`)

- Small results come back inline as base64 with `mimeType`, `bytes` and `sha256`. With the default `auto` delivery that means up to 4 MB in total; larger results switch to links. The agent can force `inline` (up to the inline limit) or `link`.
- A link is a one-time URL on your public address (`/files/<secret>`). It works for five minutes and for one successful download, belongs to the connection that asked, and stops working when that connection is revoked or disconnects. An interrupted download may be retried until the link expires. Links are kept in memory, so a restart ends them.
- Links need a configured public URL (see [Tunnels and public HTTPS](17-tunnels.md)); otherwise those files fail with `PUBLIC_URL_REQUIRED`.
- If the file changes between the approval and the download, the transfer is refused.

## Limits

Open **Settings** to change the limits, in MB: per file (default 200), per batch (default 500) and inline (default 50, at most 256). The values are clamped so inline is never above the per-file limit and the per-file limit never above the batch limit. A public tunnel may cap request bodies before they reach Aevra (about 100 MB on common plans), so use URLs or links for large files.

## Turning the tools off

Use **Settings > Tools** to switch `files_download` or `files_upload` off for every client; see [Token usage and tool surface](21-token-usage-and-tool-surface.md).
