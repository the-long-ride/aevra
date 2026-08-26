import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  generateReleaseNotes,
  normalizeTag,
  parseChangelogSections,
  tagToVersion,
} from '../release-notes.mjs';

test('normalizeTag and tagToVersion handle tags, refs, and clean semver', () => {
  assert.equal(normalizeTag('refs/tags/v0.1.2'), 'v0.1.2');
  assert.equal(normalizeTag('v0.1.2'), 'v0.1.2');
  assert.equal(normalizeTag('0.1.2'), '0.1.2');
  assert.equal(normalizeTag(''), '');

  assert.equal(tagToVersion('refs/tags/v0.1.2'), '0.1.2');
  assert.equal(tagToVersion('v0.1.2'), '0.1.2');
  assert.equal(tagToVersion('0.1.2'), '0.1.2');
});

test('parseChangelogSections parses versions, bodies, and previous version pointers', () => {
  const sample = `# Changelog

## [1.2.0] - 2026-08-20
### Added
- Feature B

## [1.1.0] - 2026-08-10
### Fixed
- Bug A

## [1.0.0] - 2026-08-01
Initial release
`;

  const sections = parseChangelogSections(sample);
  assert.equal(sections.length, 3);

  assert.equal(sections[0].version, '1.2.0');
  assert.equal(sections[0].prevVersion, '1.1.0');
  assert.equal(sections[0].body, '### Added\n- Feature B');

  assert.equal(sections[1].version, '1.1.0');
  assert.equal(sections[1].prevVersion, '1.0.0');
  assert.equal(sections[1].body, '### Fixed\n- Bug A');

  assert.equal(sections[2].version, '1.0.0');
  assert.equal(sections[2].prevVersion, null);
  assert.equal(sections[2].body, 'Initial release');
});

test('generateReleaseNotes formats header with npm link and update command before changelog', () => {
  const sample = `# Changelog

## [0.2.0] - 2026-08-26
### Added
- Super cool feature

## [0.1.0] - 2026-08-20
Initial release
`;

  const notes = generateReleaseNotes({
    tag: 'v0.2.0',
    changelogContent: sample,
    packageName: '@the-long-ride/aevra',
    repoUrl: 'https://github.com/the-long-ride/aevra',
  });

  const lines = notes.split('\n');
  assert.match(
    lines[0],
    /\*\*npm\*\*:\s*\[https:\/\/www\.npmjs\.com\/package\/@the-long-ride\/aevra\]/,
  );
  assert.equal(lines[2], '### Update aevra');
  assert.equal(lines[3], '```bash');
  assert.equal(lines[4], 'npm install -g @the-long-ride/aevra@latest');
  assert.equal(lines[5], '```');

  // Verify changelog body is included
  assert.match(notes, /### Added\n- Super cool feature/);

  // Verify compare diff link with previous tag is included
  assert.match(
    notes,
    /\*\*Full Changelog\*\*:\s*https:\/\/github\.com\/the-long-ride\/aevra\/compare\/v0\.1\.0\.\.\.v0\.2\.0/,
  );
});

test('generateReleaseNotes omits compare link when there is no previous tag', () => {
  const sample = `# Changelog

## [0.1.0] - 2026-08-20
Initial release of project
`;

  const notes = generateReleaseNotes({
    tag: 'v0.1.0',
    changelogContent: sample,
    packageName: '@the-long-ride/aevra',
  });

  assert.match(notes, /npm install -g @the-long-ride\/aevra@latest/);
  assert.match(notes, /Initial release of project/);
  assert.doesNotMatch(notes, /Full Changelog/);
});

test('generateReleaseNotes throws if tag version is missing from changelog', () => {
  const sample = `# Changelog\n\n## [0.1.0] - 2026-08-20\nInitial`;
  assert.throws(
    () =>
      generateReleaseNotes({
        tag: 'v9.9.9',
        changelogContent: sample,
      }),
    /Version "9\.9\.9" not found in CHANGELOG\.md/,
  );
});

test('generateReleaseNotes extracts real repository CHANGELOG.md for current version', () => {
  const changelogContent = readFileSync('CHANGELOG.md', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  const notes = generateReleaseNotes({
    tag: `v${pkg.version}`,
    changelogContent,
    packageName: pkg.name,
    repoUrl: 'https://github.com/the-long-ride/aevra',
  });

  assert.match(notes, /\*\*npm\*\*:/);
  assert.match(notes, /npm install -g @the-long-ride\/aevra@latest/);
  assert.match(notes, /OAuth connection continuity/);
  assert.match(
    notes,
    /\*\*Full Changelog\*\*:\s*https:\/\/github\.com\/the-long-ride\/aevra\/compare\/v0\.1\.1\.\.\.v0\.1\.2/,
  );
});
