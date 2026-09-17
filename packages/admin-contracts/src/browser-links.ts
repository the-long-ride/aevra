const REPOSITORY = 'https://github.com/the-long-ride/aevra';

/**
 * Where the extension and its guide live. Kept in one place because the CLI,
 * the web UI, and the docs all point at them, and a link that drifts between
 * surfaces sends people to a page that no longer exists.
 */
export const BROWSER_EXTENSION_DOWNLOAD_URL = `${REPOSITORY}/releases/latest`;
export const BROWSER_CONTROL_GUIDE_URL = `${REPOSITORY}/blob/main/docs/user-manual/18-browser-control.md`;

/**
 * The extension is versioned with Aevra itself, so `aevra extension install`
 * asks for the archive matching the binary that is running rather than for
 * whatever happens to be latest. A newer extension paired against an older
 * worker is a mismatch nobody asked for.
 */
export function browserExtensionZipUrl(version: string): string {
  return `${REPOSITORY}/releases/download/v${version}/aevra-extension.zip`;
}
