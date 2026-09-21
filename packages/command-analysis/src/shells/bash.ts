import type { Reason } from '../types.js';
import { extractRedirects } from './common.js';
import type { ParsedShellStage } from './powershell.js';

export function tokenizeBash(script: string): { stages: ParsedShellStage[]; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const stages: ParsedShellStage[] = [];

  if (/\beval\b/.test(script)) {
    reasons.push({ code: 'DYNAMIC_SCOPE', message: 'Dynamic evaluation (eval) detected' });
  }
  if (/\$\(/.test(script) || /`[^`]+`/.test(script)) {
    reasons.push({ code: 'DYNAMIC_SCOPE', message: 'Command substitution detected' });
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

    if (char === '\\' && !inSingleQuote) {
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

    // Delimiters
    if (char === '&' && script[i + 1] === '&') {
      flushStage('success');
      i++;
      continue;
    }

    // A background-list operator still separates two independently executed
    // commands for authorization purposes. Model it as a sequence so policy
    // checks see both sides instead of treating the second command as argv.
    if (char === '&') {
      flushStage('sequence');
      continue;
    }

    if (char === '|' && script[i + 1] === '|') {
      flushStage('failure');
      i++;
      continue;
    }

    if (char === ';') {
      flushStage('sequence');
      continue;
    }

    if (char === '\n' || char === '\r') {
      flushStage('sequence');
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

  if (escapeNext || inSingleQuote || inDoubleQuote) {
    reasons.push({
      code: 'UNSUPPORTED_SYNTAX',
      message: 'Malformed Bash quoting or trailing escape cannot be analyzed safely',
    });
  }

  flushStage();

  return { stages, reasons };
}
