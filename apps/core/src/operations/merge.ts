import type { ConflictRange } from '../../../../packages/protocol/src/index.js';
interface Hunk {
  start: number;
  end: number;
  replacement: string[];
}
function lines(s: string) {
  return s.replace(/\r\n/g, '\n').split('\n');
}
function diff(base: string[], next: string[]): Hunk[] {
  const n = base.length,
    m = next.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] =
        base[i] === next[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  let i = 0,
    j = 0,
    start: number | null = null,
    end = 0,
    repl: string[] = [];
  const out: Hunk[] = [];
  const flush = () => {
    if (start !== null) {
      out.push({ start, end, replacement: repl });
      start = null;
      repl = [];
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === next[j]) {
      flush();
      i++;
      j++;
      continue;
    }
    if (start === null) {
      start = i;
      end = i;
    }
    if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      repl.push(next[j]!);
      j++;
    } else if (i < n) {
      i++;
      end = i;
    }
  }
  flush();
  return out;
}
function overlaps(a: Hunk, b: Hunk) {
  const ai = a.start === a.end,
    bi = b.start === b.end;
  if (ai && bi) return a.start === b.start;
  if (ai) return a.start >= b.start && a.start <= b.end;
  if (bi) return b.start >= a.start && b.start <= a.end;
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}
export function mergeText(
  baseText: string,
  currentText: string,
  requestedText: string,
): { kind: 'merged'; content: string } | { kind: 'conflict'; ranges: ConflictRange[] } {
  const eol = currentText.includes('\r\n') ? '\r\n' : '\n';
  const b = lines(baseText),
    c = lines(currentText),
    r = lines(requestedText);
  const ch = diff(b, c),
    rh = diff(b, r),
    conflicts: ConflictRange[] = [];
  for (const a of ch)
    for (const x of rh)
      if (overlaps(a, x))
        conflicts.push({ baseStart: Math.min(a.start, x.start), baseEnd: Math.max(a.end, x.end) });
  if (conflicts.length) return { kind: 'conflict', ranges: conflicts };
  const all = [...ch, ...rh].sort((x, y) => y.start - x.start || y.end - x.end);
  const merged = [...b];
  for (const h of all) merged.splice(h.start, h.end - h.start, ...h.replacement);
  return { kind: 'merged', content: merged.join(eol) };
}
