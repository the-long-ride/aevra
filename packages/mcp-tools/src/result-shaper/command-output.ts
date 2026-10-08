import { isRecord, type Json } from './common.js';

const HEAD_SHARE = 0.25;

/** CRLF -> LF, progress redraws keep their last state, long runs of one line collapse. */
export function tidyOutput(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r').filter((part) => part !== '');
      return parts.at(-1) ?? '';
    });
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    let end = i + 1;
    while (end < lines.length && lines[end] === line) end += 1;
    const run = end - i;
    if (run >= 3 && line.trim() !== '') {
      out.push(line, `… (repeated ${run}×)`);
    } else {
      for (let n = 0; n < run; n += 1) out.push(line);
    }
    i = end;
  }
  return out.join('\n');
}

export function budgetOutput(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  const head = Math.floor(budget * HEAD_SHARE);
  const tail = budget - head;
  const omitted = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}\n… [${omitted} chars omitted] …\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}

export function looksLikeCommandResult(value: unknown): value is Json {
  return isRecord(value) && 'exitCode' in value && typeof value.stdout === 'string';
}

export function shapeCommandValue(value: Json, budget: number): Json {
  const shaped: Json = { ...value };
  let truncated = false;
  for (const key of ['stdout', 'stderr'] as const) {
    if (typeof shaped[key] !== 'string') continue;
    const cut = budgetOutput(tidyOutput(shaped[key] as string), budget);
    shaped[key] = cut.text;
    truncated ||= cut.truncated;
  }
  if (shaped.signal === null) delete shaped.signal;
  if (shaped.stderr === '') delete shaped.stderr;
  if (truncated) shaped.truncated = true;
  return shaped;
}
