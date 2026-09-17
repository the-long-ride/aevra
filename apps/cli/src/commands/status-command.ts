import {
  BROWSER_CONTROL_GUIDE_URL,
  BROWSER_EXTENSION_DOWNLOAD_URL,
} from '../../../../packages/admin-contracts/src/browser-links.js';
import type { AevraCommand } from '../args.js';

type StatusCommand = Extract<AevraCommand, { command: 'status' }>;

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface StatusCommandDependencies<Config> {
  fetch(config: Config, path: string): Promise<ResponseLike>;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

interface BrowserStatus {
  paired: boolean;
  extensionId: string | null;
}

/**
 * Read on its own and tolerated on its own. A core built without browser
 * control, or one too old to answer, must not turn `aevra status` into a
 * failure - the exposure lines are what the command exists for.
 */
async function browserStatus<Config>(
  config: Config,
  dependencies: StatusCommandDependencies<Config>,
): Promise<BrowserStatus | null> {
  try {
    const response = await dependencies.fetch(config, '/api/browser');
    if (!response.ok) return null;
    const state = (await response.json()) as { extensionId?: unknown };
    const extensionId = typeof state.extensionId === 'string' ? state.extensionId : null;
    return { paired: extensionId !== null, extensionId };
  } catch {
    return null;
  }
}

export async function runStatusCommand<Config>(
  config: Config,
  command: StatusCommand,
  dependencies: StatusCommandDependencies<Config>,
): Promise<number> {
  try {
    const response = await dependencies.fetch(config, '/api/exposure/status');
    if (!response.ok) throw new Error(`Core returned ${response.status}`);

    const status = (await response.json()) as Record<string, unknown>;
    const browser = await browserStatus(config, dependencies);
    if (command.json) {
      dependencies.log(JSON.stringify({ ...status, browser }, null, 2));
      return 0;
    }

    const rows: Array<[string, unknown]> = [
      ['Exposure', status.provider],
      ['State', status.state],
      ['Public', status.publicUrl],
      ['Gateway', status.localGatewayUrl],
    ];
    for (const [label, value] of rows) {
      if (value !== undefined && value !== null && value !== '') {
        dependencies.log(`${label}: ${String(value)}`);
      }
    }

    if (browser?.paired) {
      dependencies.log(`Browser: extension paired (${browser.extensionId})`);
    } else if (browser) {
      // Said once, with both links, rather than as a recurring nag: an agent
      // cannot drive a browser until an extension is installed and paired, and
      // this is the only place the CLI can say so.
      dependencies.log('Browser: no extension paired - Aevra cannot control a browser yet');
      dependencies.log(`  Download: ${BROWSER_EXTENSION_DOWNLOAD_URL}`);
      dependencies.log(`  Setup guide: ${BROWSER_CONTROL_GUIDE_URL}`);
    }
    return 0;
  } catch (error) {
    const message = dependencies.formatError(error);
    if (command.json) {
      dependencies.log(
        JSON.stringify({
          core: 'unreachable',
          error: message,
        }),
      );
    } else {
      dependencies.error(`[aevra] status failed: ${message}. Is aevra start/service running?`);
    }
    return 1;
  }
}
