import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [
  sourceRoot = 'helper-artifacts',
  destinationRoot = 'dist/helper',
  releaseRoot = 'desktop-helper-release-assets',
] = process.argv.slice(2);

if (!existsSync(sourceRoot)) {
  throw new Error(`Desktop helper artifact directory not found: ${sourceRoot}`);
}

mkdirSync(destinationRoot, { recursive: true });
mkdirSync(releaseRoot, { recursive: true });

const artifacts = readdirSync(sourceRoot, { withFileTypes: true }).filter(
  (entry) => entry.isDirectory() && entry.name.startsWith('desktop-helper-'),
);
if (!artifacts.length) throw new Error('No desktop-helper-* artifacts were downloaded');

for (const artifact of artifacts) {
  const slug = artifact.name.slice('desktop-helper-'.length);
  const sourceDir = path.join(sourceRoot, artifact.name);
  const binary = readdirSync(sourceDir).find((name) => name.startsWith('aevra-desktop-helper'));
  if (!binary) throw new Error(`No helper binary found in ${sourceDir}`);

  const packageDir = path.join(destinationRoot, slug);
  mkdirSync(packageDir, { recursive: true });
  const packagedBinary = path.join(packageDir, binary);
  copyFileSync(path.join(sourceDir, binary), packagedBinary);
  if (path.extname(binary) !== '.exe') chmodSync(packagedBinary, 0o755);

  const extension = path.extname(binary);
  const releaseName = `aevra-desktop-helper-${slug}${extension}`;
  const releaseBinary = path.join(releaseRoot, releaseName);
  copyFileSync(path.join(sourceDir, binary), releaseBinary);
  if (extension !== '.exe') chmodSync(releaseBinary, 0o755);
  process.stdout.write(`${slug}: ${binary}\n`);
}
