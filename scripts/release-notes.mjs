import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeTag(tag) {
  if (!tag) return '';
  return tag.replace(/^refs\/tags\//, '').trim();
}

export function tagToVersion(tag) {
  const normalized = normalizeTag(tag);
  return normalized.replace(/^v/, '');
}

export function parseChangelogSections(content) {
  const sectionRegex = /^##\s+\[?v?([0-9A-Za-z.-]+)\]?(?:\s*-\s*([^\n\r]*))?$/gm;
  const sections = [];
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({
      version: match[1],
      date: match[2]?.trim() || '',
      header: match[0],
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const nextSection = sections[i + 1];
    const end = nextSection ? nextSection.startIndex : content.length;
    sections[i].body = content.slice(sections[i].contentStartIndex, end).trim();
    sections[i].prevVersion = nextSection ? nextSection.version : null;
  }

  return sections;
}

export function generateReleaseNotes({
  tag,
  changelogContent,
  packageName = '@the-long-ride/aevra',
  repoUrl = 'https://github.com/the-long-ride/aevra',
}) {
  const version = tagToVersion(tag);
  const normalizedTag = tag ? (tag.startsWith('v') ? tag : `v${version}`) : `v${version}`;
  const sections = parseChangelogSections(changelogContent);
  const section = sections.find((s) => s.version === version);

  if (!section) {
    throw new Error(
      `Version "${version}" not found in CHANGELOG.md. Available versions: ${sections.map((s) => s.version).join(', ')}`,
    );
  }

  const parts = [
    `**npm**: [https://www.npmjs.com/package/${packageName}](https://www.npmjs.com/package/${packageName})`,
    '',
    '### Update aevra',
    '```bash',
    `npm install -g ${packageName}@latest`,
    '```',
    '',
    '---',
    '',
    section.body,
  ];

  if (section.prevVersion) {
    const prevTag = `v${section.prevVersion}`;
    parts.push('', '---', `**Full Changelog**: ${repoUrl}/compare/${prevTag}...${normalizedTag}`);
  }

  return parts.join('\n') + '\n';
}

export function runCli(argv = process.argv.slice(2)) {
  const rootDir = process.cwd();
  const pkgPath = path.join(rootDir, 'package.json');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const changelogContent = readFileSync(changelogPath, 'utf8');

  const rawTag = argv[0] || process.env.TAG || process.env.GITHUB_REF_NAME || `v${pkg.version}`;
  const outputFile = argv[1];

  const repo = process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : 'https://github.com/the-long-ride/aevra';

  const notes = generateReleaseNotes({
    tag: rawTag,
    changelogContent,
    packageName: pkg.name || '@the-long-ride/aevra',
    repoUrl: repo,
  });

  if (outputFile) {
    writeFileSync(path.resolve(rootDir, outputFile), notes, 'utf8');
  } else {
    process.stdout.write(notes);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli();
}
