export const FILE_TRANSFER_SETTING_KEY = 'files.transfer';

export interface TransferLimits {
  maxFileMb: number;
  maxBatchMb: number;
  inlineMb: number;
}

export const DEFAULT_TRANSFER_LIMITS: Readonly<TransferLimits> = Object.freeze({
  maxFileMb: 200,
  maxBatchMb: 500,
  inlineMb: 50,
});

const MIN_MB = 1;
const MAX_MB = 10240;
/** The inline path buffers base64 in memory, so it has a lower ceiling than file and batch. */
const MAX_INLINE_MB = 256;
const MB = 1024 * 1024;

function clampMb(value: unknown, fallback: number): number {
  const number = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_MB, Math.min(MAX_MB, Math.trunc(number)));
}

/** Clamp file and batch to [1, 10240] MB, inline to [1, 256] MB, and force inline <= file <= batch. */
export function normalizeTransferLimits(value: unknown): TransferLimits {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const maxBatchMb = clampMb(input.maxBatchMb, DEFAULT_TRANSFER_LIMITS.maxBatchMb);
  const maxFileMb = Math.min(
    clampMb(input.maxFileMb, DEFAULT_TRANSFER_LIMITS.maxFileMb),
    maxBatchMb,
  );
  const inlineMb = Math.min(
    clampMb(input.inlineMb, DEFAULT_TRANSFER_LIMITS.inlineMb),
    maxFileMb,
    MAX_INLINE_MB,
  );
  return { maxFileMb, maxBatchMb, inlineMb };
}

export function transferLimitBytes(limits: TransferLimits): {
  file: number;
  batch: number;
  inline: number;
} {
  return {
    file: limits.maxFileMb * MB,
    batch: limits.maxBatchMb * MB,
    inline: limits.inlineMb * MB,
  };
}
