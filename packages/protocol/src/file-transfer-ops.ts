import type { ProtectedGlob } from './worker.js';

/** Where the bytes of one `files_download` entry come from. Inline bytes ride the IPC upload stream. */
export type FileTransferSource =
  { type: 'inline' } | { type: 'url'; url: string; headers?: Record<string, string> };

export type FileTransferOperation =
  | {
      kind: 'files.download.entry';
      path: string;
      mimeType: string;
      overwrite: boolean;
      source: FileTransferSource;
      maxBytes: number;
      timeoutMs: number;
    }
  | {
      kind: 'files.upload.stat';
      path: string;
      /** false skips hashing (size and type only); the result then has no sha256. */
      hash?: boolean;
      protectedGlobs?: ProtectedGlob[];
    }
  | {
      kind: 'files.upload.read';
      path: string;
      sha256: string;
      /** Size-based IPC deadline; the ipc client reads it. */
      timeoutMs?: number;
      protectedGlobs?: ProtectedGlob[];
    };

export const FILE_TRANSFER_OPERATION_KINDS = [
  'files.download.entry',
  'files.upload.stat',
  'files.upload.read',
] as const;
