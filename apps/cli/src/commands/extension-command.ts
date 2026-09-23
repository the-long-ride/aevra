import path from 'node:path';
import { browserExtensionZipUrl } from '../../../../packages/admin-contracts/src/browser-links.js';
import type { AevraCommand } from '../args.js';
import { readZipEntries, safeEntryPath, type ArchiveEntry } from './extension-archive.js';

type ExtensionCommand = Extract<AevraCommand, { command: 'extension' }>;

/** The folder the archive unpacks into, and the folder Chrome is pointed at. */
const EXTENSION_FOLDER = 'aevra-extension';

interface PlannedFile {
  file: string;
  data: Buffer;
}

export interface ExtensionCommandDependencies {
  version: string;
  download(url: string): Promise<Buffer>;
  /** Returns the answer, or the fallback when the user just presses enter. */
  ask(question: string, fallback: string): Promise<string>;
  isInteractive(): boolean;
  defaultDirectory(): string;
  hasContents(directory: string): boolean;
  remove(directory: string): void;
  writeEntry(file: string, data: Buffer): void;
  log(message: string): void;
  error(message: string): void;
  formatError(error: unknown): string;
}

/**
 * Resolves every destination path before anything is written, so a hostile
 * entry is refused with the folder still untouched rather than part way
 * through being replaced.
 */
function plan(root: string, entries: ArchiveEntry[]): PlannedFile[] {
  return entries.map((entry) => ({ file: safeEntryPath(root, entry.name), data: entry.data }));
}

async function chooseDirectory(
  command: ExtensionCommand,
  dependencies: ExtensionCommandDependencies,
): Promise<string> {
  if (command.dir) return path.resolve(command.dir);
  if (!dependencies.isInteractive()) {
    throw Object.assign(
      new Error('extension install needs --dir when there is no terminal to ask on'),
      { code: 'EXTENSION_DIR_REQUIRED' },
    );
  }
  const fallback = dependencies.defaultDirectory();
  const answer = await dependencies.ask(
    `Where should the extension be unzipped? [${fallback}]`,
    fallback,
  );
  return path.resolve(answer.trim() || fallback);
}

function explain(destination: string, dependencies: ExtensionCommandDependencies): void {
  dependencies.log('');
  dependencies.log('Load it into your browser:');
  dependencies.log('  1. Open chrome://extensions (edge://extensions on Edge)');
  dependencies.log('  2. Turn on Developer mode');
  dependencies.log(`  3. Select Load unpacked and choose ${destination}`);
  dependencies.log('');
  // Chrome derives an unpacked extension's id from its folder path, and the
  // pairing is bound to that id, so moving the folder silently unpairs it.
  dependencies.log('Keep that folder where it is - moving it changes the extension id');
  dependencies.log('and the browser has to be paired again.');
  dependencies.log('');
  dependencies.log('Then pair it from Settings > Browser control > Pair extension.');
}

export async function runExtensionCommand(
  command: ExtensionCommand,
  dependencies: ExtensionCommandDependencies,
): Promise<number> {
  try {
    const parent = await chooseDirectory(command, dependencies);
    const destination = path.join(parent, EXTENSION_FOLDER);

    // Checked up front so a doomed run does not download first. The folder is
    // not touched yet.
    const occupied = dependencies.hasContents(destination);
    if (occupied && !command.yes) {
      // Replacing an installed extension is destructive and, because Chrome
      // keys an unpacked extension to its folder, it is also the thing that
      // would unpair a browser. It does not happen without being asked for.
      dependencies.error(
        `[aevra] ${destination} already has files in it. Re-run with --yes to replace it.`,
      );
      return 1;
    }

    const url = browserExtensionZipUrl(dependencies.version);
    dependencies.log(`[aevra] Downloading ${url}`);
    const planned = plan(parent, readZipEntries(await dependencies.download(url)));

    // Only now - with the archive downloaded, read, checksummed, and every
    // destination path validated - is the existing install removed. Removing it
    // first would mean a failed download left the user with no extension at all,
    // and, because the id is bound to the folder, an unpaired browser.
    if (occupied) {
      dependencies.log(`[aevra] Replacing ${destination}`);
      dependencies.remove(destination);
    }
    for (const item of planned) dependencies.writeEntry(item.file, item.data);

    dependencies.log(`[aevra] Unzipped ${planned.length} files into ${destination}`);
    explain(destination, dependencies);
    return 0;
  } catch (error) {
    dependencies.error(`[aevra] extension install failed: ${dependencies.formatError(error)}`);
    return 1;
  }
}
