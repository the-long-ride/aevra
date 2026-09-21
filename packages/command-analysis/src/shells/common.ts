export interface RawToken {
  text: string;
  span: { start: number; end: number };
  quoted: boolean;
}

export interface RedirectTarget {
  path: string;
  kind: 'write' | 'append' | 'read';
}

export function extractRedirects(tokens: string[]): {
  cleanTokens: string[];
  redirects: RedirectTarget[];
} {
  const cleanTokens: string[] = [];
  const redirects: RedirectTarget[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token === '>' || token === '1>' || token === '2>') {
      if (i + 1 < tokens.length) {
        redirects.push({ path: tokens[i + 1]!, kind: 'write' });
        i += 2;
        continue;
      }
    } else if (token === '>>' || token === '1>>' || token === '2>>') {
      if (i + 1 < tokens.length) {
        redirects.push({ path: tokens[i + 1]!, kind: 'append' });
        i += 2;
        continue;
      }
    } else if (token === '<') {
      if (i + 1 < tokens.length) {
        redirects.push({ path: tokens[i + 1]!, kind: 'read' });
        i += 2;
        continue;
      }
    } else if (token.startsWith('>') && token.length > 1) {
      redirects.push({ path: token.slice(1), kind: 'write' });
      i++;
      continue;
    } else if (token.startsWith('>>') && token.length > 2) {
      redirects.push({ path: token.slice(2), kind: 'append' });
      i++;
      continue;
    }
    cleanTokens.push(token);
    i++;
  }

  return { cleanTokens, redirects };
}
