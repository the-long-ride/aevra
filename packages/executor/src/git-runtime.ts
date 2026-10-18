import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const isolatedConfig = mkdtempSync(path.join(tmpdir(), 'aevra-git-config-'));
const emptyConfig = path.join(isolatedConfig, 'config');
const emptyHooks = path.join(isolatedConfig, 'hooks');
writeFileSync(emptyConfig, '', { mode: 0o600 });
mkdirSync(emptyHooks);
import type { ProtectedGlob } from '../../protocol/src/worker.js';
import { buildChildEnvironment } from '../../security/src/environment.js';
import { runCommand } from './commands.js';

const CONFIG = [
  'core.fsmonitor=false',
  `core.hooksPath=${emptyHooks}`,
  'core.pager=cat',
  'core.attributesFile=',
  'diff.external=',
  'core.sshCommand=ssh',
  'commit.gpgsign=false',
  'core.quotePath=true',
];

export async function runGit(cwd: string, args: string[], raw = false) {
  const environment = {
    ...buildChildEnvironment(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const config = [...CONFIG];
  if (args[0] !== 'push') config.push('protocol.allow=never');
  // Working-tree conversion can invoke a repository-defined clean filter even
  // with --no-ext-diff. Disable every configured filter driver before reading.
  if (args[0] !== 'config') {
    const filters = await runGit(
      cwd,
      ['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'],
      true,
    );
    for (const key of filters.stdout.trim().split(/\r?\n/).filter(Boolean)) {
      if (/^filter\.[^\r\n=]+\.(clean|smudge|process|required)$/i.test(key))
        config.push(`${key}=${key.endsWith('.required') ? 'false' : ''}`);
    }
  }
  return runCommand(
    {
      executable: 'git',
      args: ['--no-pager', ...config.flatMap((value) => ['-c', value]), ...args],
      cwdLogical: '/',
      env: {},
      timeoutMs: 120_000,
    },
    cwd,
    { environment, rawOutput: raw },
  );
}

const HIDDEN = [
  '**/.env',
  '**/.env.*',
  '**/*id_rsa',
  '**/*id_ed25519',
  '**/*id_ecdsa',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/*private*key*',
  '**/*credentials*',
  '**/*secret*.json*',
  '**/*.npmrc',
  '**/*.pypirc',
  '**/.git/**',
];
export function protectedGitArgs(
  args: string[],
  globs: ProtectedGlob[] = [],
  excludedFiles: string[] = [],
) {
  const index = args.indexOf('--');
  const options = index < 0 ? args : args.slice(0, index);
  const paths = index < 0 ? [] : args.slice(index + 1);
  const excludes = [
    ...HIDDEN,
    ...globs.map((item) => item.glob.replaceAll('\\', '/').replace(/^\//, '')),
  ];
  return [
    ...options,
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--',
    ...(paths.length ? paths : ['.']),
    ...excludes.map((pattern) => `:(exclude,glob,icase)${pattern}`),
    ...excludedFiles,
  ];
}
