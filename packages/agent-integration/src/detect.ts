import { statSync } from 'node:fs';
import path from 'node:path';
import { AGENT_TARGETS } from './types.js';
import type { AgentScope, AgentTarget } from './types.js';

export interface DetectedAgent {
  target: AgentTarget;
  found: boolean;
  evidence: 'path' | 'config' | 'none';
  configPath: string;
  scopes: AgentScope[];
}

export interface DetectInput {
  home: string;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

const EXECUTABLE: Record<AgentTarget, string> = {
  codex: 'codex',
  'claude-code': 'claude',
  opencode: 'opencode',
  antigravity: 'antigravity',
};

function isKind(file: string, kind: 'file' | 'directory'): boolean {
  try {
    const stat = statSync(file);
    return kind === 'file' ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

export function executableNames(name: string, env: DetectInput['env'], win: boolean): string[] {
  if (!win) return [name];
  const raw = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const names = [name];
  for (const ext of raw.split(';')) {
    const suffix = ext.trim();
    if (!suffix) continue;
    for (const candidate of [name + suffix, name + suffix.toLowerCase()])
      if (!names.includes(candidate)) names.push(candidate);
  }
  return names;
}

function onPath(name: string, env: DetectInput['env'], platform: NodeJS.Platform): boolean {
  const win = platform === 'win32';
  const searchPath = env.PATH ?? (win ? env.Path : undefined);
  if (!searchPath) return false;
  const names = executableNames(name, env, win);
  for (const dir of searchPath.split(win ? ';' : path.delimiter)) {
    if (!dir) continue;
    if (names.some((candidate) => isKind(path.join(dir, candidate), 'file'))) return true;
  }
  return false;
}

interface ConfigPlace {
  configPath: string;
  evidence: Array<{ file: string; kind: 'file' | 'directory' }>;
}

function configPlace(target: AgentTarget, input: DetectInput): ConfigPlace {
  const { home, env } = input;
  switch (target) {
    case 'codex': {
      const dir = env.CODEX_HOME || path.join(home, '.codex');
      return { configPath: dir, evidence: [{ file: dir, kind: 'directory' }] };
    }
    case 'claude-code': {
      const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
      const file = env.CLAUDE_CONFIG_DIR
        ? path.join(dir, '.claude.json')
        : path.join(home, '.claude.json');
      return {
        configPath: file,
        evidence: [
          { file, kind: 'file' },
          { file: dir, kind: 'directory' },
        ],
      };
    }
    case 'opencode': {
      const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
      const evidence: ConfigPlace['evidence'] = [{ file: dir, kind: 'directory' }];
      if (env.OPENCODE_CONFIG) {
        evidence.unshift({ file: env.OPENCODE_CONFIG, kind: 'file' });
        return { configPath: env.OPENCODE_CONFIG, evidence };
      }
      return { configPath: dir, evidence };
    }
    case 'antigravity': {
      const dir = path.join(home, '.gemini');
      return { configPath: dir, evidence: [{ file: dir, kind: 'directory' }] };
    }
  }
}

export function detectAgents(input: DetectInput): DetectedAgent[] {
  const platform = input.platform ?? process.platform;
  return AGENT_TARGETS.map((target) => {
    const place = configPlace(target, input);
    let evidence: DetectedAgent['evidence'] = 'none';
    if (onPath(EXECUTABLE[target], input.env, platform)) evidence = 'path';
    else if (place.evidence.some((item) => isKind(item.file, item.kind))) evidence = 'config';
    return {
      target,
      found: evidence !== 'none',
      evidence,
      configPath: place.configPath,
      scopes: ['user', 'workspace'],
    };
  });
}
