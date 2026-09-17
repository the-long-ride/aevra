import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { AEVRA_VERSION } from '../../core/src/version.js';
import type { ExtensionCommandDependencies } from './commands/extension-command.js';

// The published archive is a few hundred kilobytes of compiled JavaScript, so
// anything approaching this size is wrong however trusted the host. The
// declared length is checked before the body is read, because reading first and
// measuring afterwards would already have buffered whatever was sent.
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

async function downloadArchive(url: string): Promise<Buffer> {
  // A server that accepts the connection and then stalls would otherwise leave
  // the command hanging with nothing to show for it.
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `No extension archive is published for Aevra ${AEVRA_VERSION}`
        : `Download failed with HTTP ${response.status}`,
    );
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new Error('Downloaded archive is larger than Aevra will accept');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  // Backstop: the length may have been absent, wrong, or chunked.
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error('Downloaded archive is larger than Aevra will accept');
  }
  return bytes;
}

export function extensionInstallDependencies(config: {
  stateDir: string;
}): ExtensionCommandDependencies {
  return {
    version: AEVRA_VERSION,
    download: downloadArchive,
    isInteractive: () => Boolean(input.isTTY),
    // Defaults inside the state directory because the folder has to stay put:
    // Chrome derives an unpacked extension's id from its path, so a download
    // parked in a temp or Downloads folder would unpair the moment it is tidied.
    defaultDirectory: () => path.join(config.stateDir, 'browser'),
    async ask(question, fallback) {
      const prompt = createInterface({ input, output });
      try {
        return (await prompt.question(`${question} `)) || fallback;
      } finally {
        prompt.close();
      }
    },
    hasContents: (directory) => existsSync(directory) && readdirSync(directory).length > 0,
    remove: (directory) => rmSync(directory, { recursive: true, force: true }),
    writeEntry(file, data) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
    log: console.log,
    error: console.error,
    formatError: (error) => (error instanceof Error ? error.message : String(error)),
  };
}
