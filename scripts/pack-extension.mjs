import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { storeZip } from './lib/zip.mjs';
import { extensionEntries } from './lib/extension-package.mjs';

// Packages the MV3 extension as plain compiled JavaScript: an unpacked tree to
// load straight from disk, and a zip of the same tree to publish. There is no
// signed package - a Chromium browser refuses a .crx that did not come from its
// own store, so signing one would only have looked like an install route
// without being one.

const SOURCE = 'apps/extension';
const DIST = path.join(SOURCE, 'dist');

function argument(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/**
 * Runs the compiler's own entry point under this Node rather than the `.bin`
 * shim, so the script works when invoked directly with `node` instead of only
 * through an npm script - and without needing a shell to launch a `.cmd`.
 */
function compile() {
  rmSync(DIST, { recursive: true, force: true });
  const entry = path.join('node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(entry)) {
    console.error(`[pack-extension] TypeScript is not installed at ${entry}`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [entry, '-p', SOURCE], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function emittedFiles(root) {
  const out = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        out.push({
          name: path.relative(root, full).replaceAll('\\', '/'),
          data: readFileSync(full),
        });
      }
    }
  };
  walk(root);
  return out;
}

function writeTree(outDir, entries) {
  for (const entry of entries) {
    const target = path.join(outDir, entry.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }
}

const outRoot = argument('--out') ?? path.join(SOURCE, 'build');
compile();
if (!existsSync(DIST)) {
  console.error('[pack-extension] the compiler produced no output');
  process.exit(1);
}

const iconSizes = [16, 32, 48, 128];
const icons = [];
for (const size of iconSizes) {
  const iconPath = path.join(SOURCE, `icons/icon-${size}.png`);
  if (existsSync(iconPath)) {
    icons.push({
      name: `icons/icon-${size}.png`,
      data: readFileSync(iconPath),
    });
  }
}

const popupHtmlPath = path.join(SOURCE, 'src/popup.html');
const popupHtml = existsSync(popupHtmlPath) ? readFileSync(popupHtmlPath, 'utf8') : undefined;

const entries = extensionEntries({
  emitted: emittedFiles(DIST),
  manifest: JSON.parse(readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8')),
  optionsHtml: readFileSync(path.join(SOURCE, 'src/options.html'), 'utf8'),
  popupHtml,
  version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  icons,
});

rmSync(outRoot, { recursive: true, force: true });
const unpacked = path.join(outRoot, 'aevra-extension');
writeTree(unpacked, entries);

const archive = path.join(outRoot, 'aevra-extension.zip');
// Nested under `aevra-extension/` so unzipping anywhere yields one folder to
// point Chrome's Load unpacked at, rather than scattering files where the user
// happened to be standing.
writeFileSync(
  archive,
  storeZip(entries.map((entry) => ({ ...entry, name: `aevra-extension/${entry.name}` }))),
);

console.log(`[pack-extension] unpacked: ${unpacked}`);
console.log(`[pack-extension] zip: ${archive}`);
