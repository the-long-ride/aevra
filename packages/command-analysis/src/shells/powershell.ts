import type { Reason } from '../types.js';
import { extractRedirects, type RedirectTarget } from './common.js';

export interface ParsedShellStage {
  argv: string[];
  redirects: RedirectTarget[];
  edgeToNext?: 'sequence' | 'success' | 'failure' | 'pipe';
  reasons: Reason[];
}

export function tokenizePowerShell(script: string): {
  stages: ParsedShellStage[];
  reasons: Reason[];
} {
  const reasons: Reason[] = [];
  const stages: ParsedShellStage[] = [];

  // Check for dynamic / dangerous expressions up front
  if (/\b(?:iex|invoke-expression)\b/i.test(script)) {
    reasons.push({
      code: 'DYNAMIC_SCOPE',
      message: 'Dynamic evaluation (Invoke-Expression / iex) detected',
    });
  }
  if (/-(?:encodedcommand|enc)\b/i.test(script)) {
    reasons.push({ code: 'DYNAMIC_SCOPE', message: 'Encoded command detected' });
  }

  let currentTokens: string[] = [];
  let currentToken = '';
  let inSingleQuote = false;
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
      // Remove leading call operator '&' if present
      if (currentTokens[0] === '&' && currentTokens.length > 1) {
        currentTokens.shift();
      }
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

    if (char === '`') {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      currentToken += char;
      continue;
    }

    // Outside quotes: check for delimiters
    if (char === ';' || char === '\n' || char === '\r') {
      flushStage('sequence');
      continue;
    }

    if (char === '|' && script[i + 1] === '|') {
      flushStage('failure');
      i++;
      continue;
    }

    if (char === '&' && script[i + 1] === '&') {
      flushStage('success');
      i++;
      continue;
    }

    if (char === '|') {
      flushStage('pipe');
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
