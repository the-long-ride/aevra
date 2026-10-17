import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
if (!targetArg)
  throw new Error(
    'Usage: node scripts/export-browser-shared.mjs --target=<browser-repository> [--check]',
  );
const target = path.resolve(targetArg.slice(9));
const output = path.join(target, 'shared/aevra');
const check = process.argv.includes('--check');
const files = new Set([
  'apps/extension/manifest.json',
  'apps/extension/tsconfig.json',
  'scripts/pack-extension.mjs',
  'scripts/lib/extension-package.mjs',
  'scripts/lib/zip.mjs',
  'package.json',
]);

function collect(folder) {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (!entry.name.endsWith('.test.ts') && !entry.name.endsWith('-test-support.ts'))
      files.add(path.relative(root, file).replaceAll('\\', '/'));
  }
}
collect(path.join(root, 'apps/extension/src'));
collect(path.join(root, 'apps/extension/icons'));
collect(path.join(root, 'packages/agent-integration/src'));
// Contract tests travel with the snapshot so consumers verify the exact shared implementation.
for (const entry of readdirSync(path.join(root, 'packages/agent-integration/test'))) {
  if (entry.endsWith('.test.ts')) files.add(`packages/agent-integration/test/${entry}`);
}

// Include only the relative import closure of the selected production files.
const pending = [...files];
while (pending.length) {
  const name = pending.pop();
  if (!name.endsWith('.ts') && !name.endsWith('.mjs')) continue;
  const source = readFileSync(path.join(root, name), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const imported = path.resolve(root, path.dirname(name), match[1]);
    const resolved = imported.endsWith('.js') ? imported.slice(0, -3) + '.ts' : imported;
    const relative = path.relative(root, resolved).replaceAll('\\', '/');
    if (relative.startsWith('../') || !existsSync(resolved))
      throw new Error(`Missing shared import: ${relative}`);
    if (!files.has(relative)) {
      files.add(relative);
      pending.push(relative);
    }
  }
}
const hashes = {};
for (const name of [...files].sort()) {
  const bytes = readFileSync(path.join(root, name));
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  const destination = path.join(output, name);
  if (check) {
    if (!existsSync(destination) || !readFileSync(destination).equals(bytes))
      throw new Error(`Shared source differs: ${name}`);
  } else {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
}
const manifest =
  JSON.stringify({ version: 1, source: '@the-long-ride/aevra', files: hashes }, null, 2) + '\n';
const manifestFile = path.join(target, 'shared/aevra-source.json');
if (check) {
  if (readFileSync(manifestFile, 'utf8') !== manifest) throw new Error('Shared manifest differs');
} else writeFileSync(manifestFile, manifest);
console.log(`Shared browser sources ${check ? 'verified' : 'exported'}: ${files.size} files`);
