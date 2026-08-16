import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('/'))) {
      const url = new URL(specifier, context.parentURL);
      const ts = fileURLToPath(url).replace(/\.js$/, '.ts');
      if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
    }
    throw error;
  }
}
