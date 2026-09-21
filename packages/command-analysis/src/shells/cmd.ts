import type { Reason } from '../types.js';
import { extractRedirects } from './common.js';
import type { ParsedShellStage } from './powershell.js';

export function tokenizeCmd(script: string): { stages: ParsedShellStage[]; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const stages: ParsedShellStage[] = [];

  let currentTokens: string[] = [];
  let currentToken = '';
  let inDoubleQuote = false;
  let escapeNext = false;

  const flushToken = () => {
    if (currentToken.length > 0) {
      currentTokens.push(currentToken);
      currentToken = '';
    }
  };

  const flushStage = (edge?: ParsedShellStage['edgeToNext']) => {
    flushToken();
    if (currentTokens.length > 0) {
      const { cleanTokens, redirects } = extractRedirects(currentTokens);
      stages.push({
        argv: cleanTokens,
        redirects,
        edgeToNext: edge,
        reasons: [],
      });
      currentTokens = [];
    }
  };

  for (let i = 0; i < script.length; i++) {
    const char = script[i]!;

    if (escapeNext) {
      currentToken += char;
      escapeNext = false;
      continue;
    }

    if (char === '^') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inDoubleQuote) {
      currentToken += char;
      continue;
    }

    // Delimiters outside quotes
    if (char === '&' && script[i + 1] === '&') {
      flushStage('success');
      i++;
      continue;
    }

    if (char === '&') {
      flushStage('sequence');
      continue;
    }

    if (char === '|' && script[i + 1] === '|') {
      flushStage('failure');
      i++;
      continue;
    }

    if (char === '|') {
      flushStage('pipe');
      continue;
    }

    if (char === '\n' || char === '\r') {
      flushStage('sequence');
      continue;
    }

    if (/\s/.test(char)) {
      flushToken();
      continue;
    }

    currentToken += char;
  }

  flushStage();

  return { stages, reasons };
}
