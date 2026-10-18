import { existsSync, lstatSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AGENT_TARGETS,
  type AgentLocation,
  type AgentManifest,
  type AgentOptions,
  type AgentScope,
  type AgentTarget,
  type Registration,
} from './types.js';
import { agentLocation } from './adapters.js';
import { rootKey } from './claude-project-key.js';
import { configEntry, parseConfig } from './config-edit.js';
import { refreshPlan, type Refresh } from './manage-change.js';
import { checkRegistration } from './manifest-validate.js';
import { assertNotTracked, gitContext, type GitContext } from './project-guard.js';
import { assertPlainWorkspacePath, samePlace } from './workspace-guard.js';
import { entryHash, hash, readText } from './files.js';
import { linkState } from './skills.js';

export function locations(options: AgentOptions) {
  const folder = path.join(options.home, '.agents/aevra');
  return {
    folder,
    manifest: path.join(folder, `${options.product}.json`),
    skill: path.join(options.home, '.agents/skills', options.product),
    lock: path.join(folder, 'integration.lock'),
  };
}

export function loadManifest(options: AgentOptions): AgentManifest {
  const raw = readText(locations(options).manifest);
  if (raw === null)
    return { version: 2, product: options.product, skillHash: '', registrations: [] };
  const value = JSON.parse(raw) as AgentManifest;
  if (
    (value.version !== 1 && value.version !== 2) ||
    value.product !== options.product ||
    !Array.isArray(value.registrations)
  )
    throw new Error('AGENT_MANIFEST_INVALID');
  // Version 1 registrations were always user scope.
  const registrations: Registration[] =
    value.version === 1
      ? value.registrations.map((reg) => ({
          ...reg,
          scope: 'user' as const,
          entryPath: AGENT_TARGETS.includes(reg.target)
            ? agentLocation(reg.target, options.home, options.env).entryPath
            : [],
        }))
      : value.registrations;
  const seen = new Set<string>();
  for (const reg of registrations) checkRegistration(options, reg, seen);
  return { ...value, version: 2, registrations };
}

export interface Selection {
  target: AgentTarget;
  scope: AgentScope;
  root?: string;
}
export interface Planned extends Selection {
  location: AgentLocation;
  previous?: Registration;
  text: string | null;
  links: string[];
  newClaudeKey: boolean;
  // Install over a registration that is still ours: what must be rewritten in place.
  refresh: Refresh | null;
  // Uninstall of a registration the user edited: what stays on disk (its credential is revoked).
  retained?: { entry?: boolean; credential?: boolean };
}

const invalid = (reason: string) => new Error(`AGENT_OPTIONS_INVALID: ${reason}`);

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

export interface Resolved {
  scope: AgentScope;
  root?: string;
  all?: boolean;
}

// Scope and root of an install/uninstall request. `root` is normalised so the manifest validator
// accepts what we store; installs need a root that exists, uninstalls only an absolute path.
export function resolveScope(options: AgentOptions): Resolved {
  const { workspaceRoot, operation } = options;
  if (options.scope !== undefined && !['user', 'workspace', 'all'].includes(options.scope))
    throw invalid('unknown scope');
  if (options.credentialId !== undefined) {
    if (operation !== 'uninstall') throw invalid('credentialId is only for uninstall');
    if (typeof options.credentialId !== 'string' || !options.credentialId)
      throw invalid('credentialId must name a registration');
    if (options.scope !== undefined || workspaceRoot !== undefined)
      throw invalid('credentialId cannot be combined with a scope or workspace folder');
    return { scope: 'user' };
  }
  if (options.scope === 'all') {
    if (operation !== 'uninstall') throw invalid('scope all is only for uninstall');
    if (workspaceRoot !== undefined) throw invalid('workspaceRoot requires workspace scope');
    return { scope: 'user', all: true };
  }
  const scope =
    options.scope ?? (operation === 'uninstall' && workspaceRoot ? 'workspace' : 'user');
  if (scope === 'user') {
    if (workspaceRoot !== undefined) throw invalid('workspaceRoot requires workspace scope');
    return { scope };
  }
  if (operation === 'install' && options.transport !== 'stdio')
    throw invalid('workspace scope requires stdio');
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot))
    throw invalid('workspaceRoot must be an absolute path');
  const root = path.resolve(workspaceRoot);
  if (operation === 'install' && !isDirectory(root))
    throw invalid(`workspaceRoot must be an existing directory: ${root}`);
  // There a workspace entry would be read by every project: it would really be global.
  if (operation === 'install' && (path.parse(root).root === root || samePlace(root, options.home)))
    throw invalid(
      `workspace folder ${root} is the home folder or a filesystem root; use user scope`,
    );
  return { scope, root };
}

export const sameRegistration = (reg: Registration, pick: Selection): boolean =>
  reg.target === pick.target &&
  reg.scope === pick.scope &&
  (pick.scope === 'user' || rootKey(reg.workspaceRoot ?? '') === rootKey(pick.root ?? ''));

// Which registrations an operation touches. Uninstall without scope keeps today's meaning (the
// user-scope entry) and, for `all`, also sweeps every workspace registration; scope `all` sweeps
// for any target; a credential id picks exactly one registration.
export function selectionsFor(
  options: AgentOptions,
  manifest: AgentManifest,
  targets: AgentTarget[],
  resolved: Resolved,
): Selection[] {
  if (options.operation === 'install')
    return targets.map((target) => ({ target, scope: resolved.scope, root: resolved.root }));
  if (options.credentialId !== undefined) {
    const reg = manifest.registrations.find((row) => row.credentialId === options.credentialId);
    if (!reg || !targets.includes(reg.target))
      throw invalid('credentialId must name a known registration');
    return [{ target: reg.target, scope: reg.scope, root: reg.workspaceRoot }];
  }
  const user = targets.map((target) => ({ target, scope: 'user' as const }));
  const workspace = manifest.registrations
    .filter((reg) => reg.scope === 'workspace' && targets.includes(reg.target))
    .map((reg) => ({ target: reg.target, scope: reg.scope, root: reg.workspaceRoot }));
  if (resolved.all) return [...user, ...workspace];
  if (options.scope === undefined && options.workspaceRoot === undefined)
    return options.target === 'all' ? [...user, ...workspace] : user;
  if (resolved.scope === 'user') return user;
  return workspace.filter((pick) => rootKey(pick.root ?? '') === rootKey(resolved.root ?? ''));
}

function checkSkill(options: AgentOptions, manifest: AgentManifest): void {
  const { skill } = locations(options);
  if (existsSync(skill) && lstatSync(skill).isSymbolicLink())
    throw new Error(`AGENT_SKILL_CONFLICT: ${skill}`);
  const content = readText(path.join(skill, 'SKILL.md'));
  if (content !== null && (!manifest.skillHash || hash(content) !== manifest.skillHash))
    throw new Error(`AGENT_SKILL_CONFLICT: modified or unmanaged ${skill}`);
}

function knowsProject(text: string | null, key: string): boolean {
  if (!text) return false;
  const projects = parseConfig(text, 'json').projects;
  return Boolean(projects) && typeof projects === 'object' && Object.hasOwn(projects, key);
}

// Uninstall only ever acts on manifest-matched entries: without a registration there is nothing
// of ours to check or remove, whatever the agent's config or skill folders hold.
function nothingToRemove(options: AgentOptions, pick: Selection): Planned {
  let location: AgentLocation = { config: '', kind: 'json', entryPath: [], skills: [] };
  try {
    location = agentLocation(pick.target, options.home, options.env, pick.scope, pick.root);
  } catch {
    // Only reported, never read or written.
  }
  return { ...pick, location, text: null, links: [], newClaudeKey: false, refresh: null };
}

function planOne(
  options: AgentOptions,
  manifest: AgentManifest,
  pick: Selection,
  install: boolean,
  git: GitContext,
): Planned {
  const { skill } = locations(options);
  const previous = manifest.registrations.find((reg) => sameRegistration(reg, pick));
  if (!install && !previous) return nothingToRemove(options, pick);
  const root = previous?.workspaceRoot ?? pick.root;
  const claude = pick.scope === 'workspace' && pick.target === 'claude-code';
  const location = agentLocation(
    pick.target,
    options.home,
    options.env,
    pick.scope,
    root,
    claude ? previous?.entryPath[1] : undefined,
  );
  if (pick.scope === 'workspace' && !claude) assertPlainWorkspacePath(location.config, root!);
  if (install && pick.scope === 'workspace' && !claude) {
    let user: string | undefined;
    try {
      user = agentLocation(pick.target, options.home, options.env).config;
    } catch {
      // No single user-scope file (two Antigravity profiles): nothing to collide with.
    }
    if (user && samePlace(user, location.config))
      throw invalid(
        `workspace config ${location.config} is the user-scope config of ${pick.target}; use user scope`,
      );
  }
  const text = readText(location.config);
  if (install && pick.scope === 'workspace' && !claude)
    assertNotTracked(location.config, root!, git.run);
  const entry = configEntry(text ?? '', location.kind, location.entryPath, options.product);
  const editedEntry = entry !== undefined && (!previous || entryHash(entry) !== previous.entryHash);
  if (editedEntry && (install || !previous))
    throw new Error(`AGENT_CONFIG_CONFLICT: ${location.config}: ${options.product}`);
  const links = location.skills.map((folder) => path.join(folder, options.product));
  for (const link of links)
    if (linkState(link, skill) === 'conflict') throw new Error(`AGENT_SKILL_CONFLICT: ${link}`);
  let editedCredential = false;
  if (previous) {
    if (previous.links.some((link) => !links.includes(link)))
      throw new Error('AGENT_MANIFEST_INVALID: skill links');
    const secret = readText(previous.credentialFile);
    editedCredential = secret !== null && hash(secret) !== previous.credentialHash;
    if (editedCredential && install) throw new Error('AGENT_CREDENTIAL_CONFLICT');
  }
  const newClaudeKey = claude && !previous && !knowsProject(text, location.entryPath[1]);
  const planned = { ...pick, root, location, previous, text, links, newClaudeKey };
  const retained =
    editedEntry || editedCredential
      ? { entry: editedEntry, credential: editedCredential }
      : undefined;
  return { ...planned, refresh: refreshPlan(options, planned), ...(retained ? { retained } : {}) };
}

export function preflight(
  options: AgentOptions,
  manifest: AgentManifest,
  picks: Selection[],
  install = false,
  git: GitContext = gitContext(options.env),
): Planned[] {
  const ours = (pick: Selection) =>
    install || manifest.registrations.some((reg) => sameRegistration(reg, pick));
  if (picks.some((pick) => pick.scope === 'user' && ours(pick))) checkSkill(options, manifest);
  return picks.map((pick) => planOne(options, manifest, pick, install, git));
}

export function registrationState(
  options: AgentOptions,
  manifest: AgentManifest,
  reg: Registration,
): 'installed' | 'incomplete' | 'conflict' {
  try {
    const [item] = preflight(options, manifest, [
      { target: reg.target, scope: reg.scope, root: reg.workspaceRoot },
    ]);
    const { skill } = locations(options);
    const complete =
      readText(reg.credentialFile) !== null &&
      item.text !== null &&
      configEntry(item.text, item.location.kind, item.location.entryPath, options.product) !==
        undefined &&
      (item.scope === 'workspace' ||
        (readText(path.join(skill, 'SKILL.md')) !== null &&
          item.links.every((link) => linkState(link, skill) === 'owned')));
    return complete ? 'installed' : 'incomplete';
  } catch {
    return 'conflict';
  }
}
