import { AEVRA_VERSION } from '../version.js';

export interface AevraServerIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

export interface AevraServerInfo {
  name: string;
  version: string;
  description: string;
  icons?: AevraServerIcon[];
}

/**
 * Describes this MCP server for the `initialize` / `server/discover`
 * handshake. When a `baseUrl` is available (the effective public URL this
 * server is reachable at), an absolute icon URL is included so that chat
 * clients such as Claude or ChatGPT can render the Aevra logo next to the
 * connector as soon as the server URL is pasted in, rather than showing a
 * generic placeholder. Relative paths are not usable here because these
 * clients fetch the icon directly from the client side, not through this
 * process.
 */
export function aevraServerInfo(baseUrl?: string): AevraServerInfo {
  const info: AevraServerInfo = {
    name: 'Aevra',
    version: AEVRA_VERSION,
    description:
      'Use Claude, ChatGPT, Grok, etc. chat to control your workspace. Operations remain protected by Aevra permissions and approval controls.',
  };
  if (baseUrl) {
    info.icons = [
      {
        src: `${baseUrl.replace(/\/$/, '')}/aevra-logo.png`,
        mimeType: 'image/png',
      },
    ];
  }
  return info;
}
