import { spawn } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const MAX_DIRECTORIES = 200;
const PICKER_TIMEOUT_MS = 30_000;

type FsLike = Pick<typeof fsPromises, 'realpath' | 'stat' | 'readdir'>;
export type FolderPickerRunner = (
  file: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: DirectoryEntry[];
}

function failure(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status });
}

function mapFsError(error: unknown, input: string): never {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    throw failure('DIRECTORY_NOT_FOUND', `Directory not found: ${input}`, 404);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    throw failure('DIRECTORY_NOT_READABLE', `Directory is not readable: ${input}`, 403);
  }
  throw error;
}

function defaultRunner(
  file: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(failure('NATIVE_PICKER_UNAVAILABLE', 'Native folder picker timed out', 503));
    }, PICKER_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isUnavailable(error: unknown) {
  const code = (error as NodeJS.ErrnoException & { code?: string })?.code;
  return code === 'ENOENT' || code === 'NATIVE_PICKER_UNAVAILABLE';
}

export class LocalFilesystemService {
  private readonly fs: FsLike;
  private readonly runner: FolderPickerRunner;
  private readonly platform: NodeJS.Platform;

  constructor(
    options: {
      fs?: FsLike;
      runner?: FolderPickerRunner;
      platform?: NodeJS.Platform;
    } = {},
  ) {
    this.fs = options.fs ?? fsPromises;
    this.runner = options.runner ?? defaultRunner;
    this.platform = options.platform ?? process.platform;
  }

  async canonicalDirectory(inputPath: string): Promise<string> {
    if (!path.isAbsolute(inputPath)) {
      throw failure('INVALID_DIRECTORY_PATH', 'Directory path must be absolute');
    }
    let canonical: string;
    try {
      canonical = await this.fs.realpath(inputPath);
      const stat = await this.fs.stat(canonical);
      if (!stat.isDirectory()) {
        throw failure('DIRECTORY_NOT_DIRECTORY', `Path is not a directory: ${inputPath}`, 400);
      }
    } catch (error) {
      mapFsError(error, inputPath);
    }
    return canonical!;
  }

  async listDirectories(inputPath: string): Promise<DirectoryListing> {
    const canonical = await this.canonicalDirectory(inputPath);
    let entries: Awaited<ReturnType<FsLike['readdir']>>;
    try {
      entries = (await this.fs.readdir(canonical, { withFileTypes: true })) as any;
    } catch (error) {
      mapFsError(error, canonical);
    }
    const directories = (entries as any[])
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: String(entry.name),
        path: path.join(canonical, String(entry.name)),
      }))
      .sort((left, right) => {
        const folded = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
        return folded || left.name.localeCompare(right.name, 'en');
      })
      .slice(0, MAX_DIRECTORIES);
    const parent = path.dirname(canonical);
    return {
      path: canonical,
      parent: parent === canonical ? null : parent,
      directories,
    };
  }

  async pickServerFolder(): Promise<{ status: 'selected'; path: string }> {
    const selected = await this.runPicker();
    const value = selected.stdout.trim();
    if (selected.code !== 0 || !value) {
      throw failure('NATIVE_PICKER_CANCELLED', 'Native folder picker was cancelled', 409);
    }
    return { status: 'selected', path: await this.canonicalDirectory(value) };
  }

  private async runPicker() {
    if (this.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
        "$dialog.Description = 'Select Aevra workspace';",
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  [Console]::Out.WriteLine($dialog.SelectedPath)',
        '} else { exit 1 }',
      ].join(' ');
      return this.runCandidate('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
    }
    if (this.platform === 'darwin') {
      return this.runCandidate('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select Aevra workspace")',
      ]);
    }
    if (this.platform === 'linux') {
      try {
        return await this.runCandidate('zenity', [
          '--file-selection',
          '--directory',
          '--title=Select Aevra workspace',
        ]);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
      }
      return this.runCandidate('kdialog', [
        '--getexistingdirectory',
        process.cwd(),
        '--title',
        'Select Aevra workspace',
      ]);
    }
    throw failure(
      'NATIVE_PICKER_UNAVAILABLE',
      'Native folder picker is unavailable on this platform',
      503,
    );
  }

  private async runCandidate(file: string, args: string[]) {
    try {
      return await this.runner(file, args);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw failure(
          'NATIVE_PICKER_UNAVAILABLE',
          `Native folder picker executable not found: ${file}`,
          503,
        );
      }
      throw error;
    }
  }
}

const defaultService = new LocalFilesystemService();

export function canonicalDirectory(inputPath: string) {
  return defaultService.canonicalDirectory(inputPath);
}

export function listDirectories(inputPath: string) {
  return defaultService.listDirectories(inputPath);
}

export function pickServerFolder() {
  return defaultService.pickServerFolder();
}
