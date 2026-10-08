export const TOKEN_ESTIMATOR = 'heuristic-v1' as const;

const ASCII_ONLY = /^[\u0000-\u007f]*$/;

function weight(codePoint: number): number {
  if (codePoint < 0x80) return 0.25;
  if (codePoint > 0xffff) return 1;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK, kana, CJK symbols
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility
    (codePoint >= 0xff00 && codePoint <= 0xffef) // full-width forms
  ) {
    return 1;
  }
  return 0.5;
}

/**
 * Estimates how many model tokens a piece of text costs. Aevra never sees the
 * model's billed count, so this is a local heuristic: good enough to compare
 * before and after, not an invoice.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (ASCII_ONLY.test(text)) return Math.ceil(text.length / 4);
  let total = 0;
  for (const char of text) total += weight(char.codePointAt(0)!);
  return Math.ceil(total);
}
