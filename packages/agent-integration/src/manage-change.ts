import { statSync } from 'node:fs';
import path from 'node:path';
import type { AgentChange, AgentOptions } from './types.js';
import { nativeEntry } from './adapters.js';
import { configEntry } from './config-edit.js';
import { excludeFromGit, type GitContext } from './project-guard.js';
import { entryHash, readText } from './files.js';
import type { Planned } from './manage-plan.js';

type Unrefreshed = Omit<Planned, 'refresh'>;

const entryPresent = (options: AgentOptions, item: Unrefreshed): boolean =>
  configEntry(item.text ?? '', item.location.kind, item.location.entryPath, options.product) !==
  undefined;

// What an install over a registration that is still ours (same transport, entry present and
// unchanged, credential file present and unchanged: planOne checked the hashes) must rewrite so
// it matches the current options: the entry (new launcher, product args or HTTP endpoint) and/or
// the credential file (endpoint, CA file). The stored credential id and token are reused; nothing
// is issued or revoked. Null when nothing differs. Computed once per item, by planOne, so the
// note, the planned change and the write all come from the same read of the credential file.
export interface Refresh {
  entry?: Record<string, unknown>;
  secret?: string;
}
export function refreshPlan(options: AgentOptions, item: Unrefreshed): Refresh | null {
  const { previous } = item;
  if (
    options.operation !== 'install' ||
    previous?.transport !== options.transport ||
    !entryPresent(options, item)
  )
    return null;
  const stored = readText(previous.credentialFile);
  if (stored === null) return null;
  let saved: { id?: unknown; token?: unknown };
  try {
    saved = JSON.parse(stored) as typeof saved;
  } catch {
    return null;
  }
  if (saved?.id !== previous.credentialId || typeof saved.token !== 'string') return null;
  // Stdio entries carry no token; an HTTP entry carries the stored one.
  const token = options.transport === 'http' ? saved.token : '';
  const entry = nativeEntry(options, item.target, previous.credentialFile, {
    id: previous.credentialId,
    token,
  });
  const secret =
    JSON.stringify({
      version: 1,
      id: previous.credentialId,
      token: saved.token,
      endpoint: options.endpoint,
      ...(options.caFile ? { caFile: options.caFile } : {}),
    }) + '\n';
  const refresh: Refresh = {
    ...(entryHash(entry) !== previous.entryHash ? { entry } : {}),
    ...(secret !== stored ? { secret } : {}),
  };
  return refresh.entry || refresh.secret ? refresh : null;
}

// The config-file change an operation makes for one registration, or null when it is a no-op.
export function plannedChange(options: AgentOptions, item: Planned): AgentChange | null {
  const { target, location, previous, text } = item;
  const present = entryPresent(options, item);
  if (options.operation === 'uninstall')
    return previous && present ? { target, file: location.config, action: 'remove' } : null;
  if (
    present &&
    previous?.transport === options.transport &&
    readText(previous.credentialFile) !== null
  )
    return item.refresh?.entry ? { target, file: location.config, action: 'update' } : null;
  return { target, file: location.config, action: text === null ? 'create' : 'update' };
}

// The credential file is not listed in `changes` (its path stays out of client output).
export const refreshNotes = (planned: Planned[]): string[] =>
  planned
    .filter((item) => item.refresh?.secret)
    .map(
      (item) =>
        `${item.target}: credential file refreshed with the current endpoint and CA file (same credential).`,
    );

function workspaceNotes(item: Planned): string[] {
  if (item.scope !== 'workspace') return [];
  const notes: string[] = [];
  if (item.target === 'codex')
    notes.push(
      'codex: Codex loads project config only for trusted projects; trust this folder in Codex.',
    );
  if (item.newClaudeKey)
    notes.push(
      `claude-code: start Claude Code in that folder once so it recognises the project (${item.location.entryPath[1]}).`,
    );
  return notes;
}

function folderExists(root: string): boolean {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}

// Uninstall of a workspace registration whose folder was deleted: only the manifest record and
// the credential can go (Claude's project entry lives in the user file and is still edited).
function goneFolderNote(item: Planned): string[] {
  if (!item.previous || item.scope !== 'workspace' || item.target === 'claude-code') return [];
  if (folderExists(item.root!)) return [];
  return [
    `${item.target}: workspace folder ${item.root} no longer exists, so its entry file could not be edited; the registration and its credential are removed.`,
  ];
}

// The exclude runs after the manifest is committed: a failure is reported, never rolled back.
function exclude(item: Planned, apply: boolean, git: GitContext): string {
  try {
    return excludeFromGit(item.location.config, item.root!, apply, git.run);
  } catch (error) {
    return `failed (${error instanceof Error ? error.message : String(error)})`;
  }
}

// Notes for the caller; with `apply` the git exclude is written, otherwise only predicted.
export function operationNotes(
  options: AgentOptions,
  planned: Planned[],
  apply: boolean,
  git: GitContext,
): string[] {
  if (options.operation === 'uninstall') return planned.flatMap(goneFolderNote);
  if (options.operation !== 'install') return [];
  const notes = planned.flatMap(workspaceNotes);
  if (planned.some((item) => item.scope === 'workspace'))
    notes.push('No skill is installed for workspace scope.');
  const unverified = new Set<string>();
  for (const item of planned) {
    if (item.scope !== 'workspace' || item.target === 'claude-code') continue;
    const file = path.relative(item.root!, item.location.config).split(path.sep).join('/');
    notes.push(`${item.target}: git exclude: ${exclude(item, apply, git)} (${file})`);
    if (git.unverified(item.root!)) unverified.add(item.root!);
  }
  for (const root of unverified)
    notes.push(
      `git could not be found outside the project folder ${root}, so git tracking was not checked.`,
    );
  return notes;
}
