import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Decides which quality-gate jobs a pull request needs from the files it
// changes. Static checks always run; pushes to main always run everything,
// because the release takes its helper and extension artifacts from that run.
export const AREAS = ['node', 'web', 'extension', 'helper'];

const ALL = AREAS;
const NONE = [];

// First match wins, so specific paths sit above the broad ones that contain them.
const RULES = [
  // Anything that changes how every job installs, builds or runs.
  [/^\.github\//, ALL],
  [/^scripts\/ci-changes\.mjs$/, ALL],
  [
    /^(package(-lock)?\.json|tsconfig[^/]*\.json|knip\.json|playwright\.config\.ts|\.npmrc|\.nvmrc)$/,
    ALL,
  ],
  [/^helper\//, ['helper']],
  [/^scripts\/stage-desktop-helpers\.mjs$/, ['helper']],
  [/^apps\/extension\//, ['extension']],
  [/^scripts\/(pack-extension\.mjs|lib\/zip\.mjs)$/, ['extension']],
  [/^(apps\/web-react|tests\/ui-parity)\//, ['web']],
  [/^packages\/admin-contracts\//, ['node', 'web']],
  [/^(apps\/(cli|core|worker|executor)|packages|tests|installers)\//, ['node']],
  // Core tests read the manual, and the package ships it.
  [/^docs\/user-manual\//, ['node']],
  // Script tests run in the static job on every pull request.
  [/^scripts\/test\//, NONE],
  [/^scripts\//, ['node']],
  [/^docs\//, NONE],
  [/\.md$/, NONE],
  [
    /^(\.prettierrc\.json|\.prettierignore|\.gitignore|\.gitattributes|\.editorconfig|LICENSE)$/,
    NONE,
  ],
];

export function areasFor(file) {
  const normalized = file.replaceAll('\\', '/');
  for (const [pattern, areas] of RULES) {
    if (pattern.test(normalized)) return areas;
  }
  // An unknown path could feed any job, so it runs them all.
  return ALL;
}

export function classify(files) {
  const needed = new Set(files.flatMap(areasFor));
  return Object.fromEntries(AREAS.map((area) => [area, needed.has(area)]));
}

function changedFiles(base) {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const base = process.env.BASE_SHA;
  let result;
  let reason;
  if (event !== 'pull_request' || !base) {
    result = classify(['.github/']);
    reason = `event ${event ?? 'unknown'} runs every job`;
  } else {
    try {
      const files = changedFiles(base);
      result = classify(files);
      reason = `${files.length} changed file${files.length === 1 ? '' : 's'}`;
    } catch (error) {
      result = classify(['.github/']);
      reason = `diff failed, running every job: ${error instanceof Error ? error.message : error}`;
    }
  }

  const lines = AREAS.map((area) => `${area}=${result[area]}`);
  console.log(`${reason}\n${lines.join('\n')}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = AREAS.map((area) => `| ${area} | ${result[area] ? 'run' : 'skip'} |`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Changed areas\n\n${reason}\n\n| Area | Jobs |\n| --- | --- |\n${rows.join('\n')}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
