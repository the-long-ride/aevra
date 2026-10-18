import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { AGENT_TARGETS, type AgentOptions, type AgentScope, type AgentTarget } from './types.js';
import { agentLocation } from './adapters.js';
import { hash, readText, writeAtomic } from './files.js';
import { locations } from './manage-plan.js';
import { createSkillLink, linkState, removeSkillLink } from './skills.js';

// A config write names the registration it belongs to, so recovery can check the path against
// what this installation computes, as the manifest's paths are checked.
export interface WriteOwner {
  target: AgentTarget;
  scope: AgentScope;
  root?: string;
}
interface JournalWrite {
  file: string;
  // The previous text, needed to undo the write. For a refreshed credential file or an HTTP
  // config this holds a token: the journal is mode 0600 and lives only until the operation ends.
  before: string | null;
  afterHash: string;
  owner?: WriteOwner;
}
interface Retired {
  id: string;
  file: string;
  hash: string;
}
interface Journal {
  version: 1;
  writes: JournalWrite[];
  linked: string[];
  removedLinks: string[];
  issued: string[];
  // Labels of credentials being created: one with no id yet may exist without a record.
  issuing: string[];
  retired: Retired[];
  // Files the finished operation removes, by the hash they must still have.
  cleanup: { file: string; hash: string }[];
  // Set right after the manifest write: from then on recovery finishes the operation.
  committed: boolean;
}

const journalPath = (options: AgentOptions) =>
  path.join(locations(options).folder, `${options.product}.pending.json`);

export const pendingJournal = (options: AgentOptions) => existsSync(journalPath(options));

// What an operation in flight is about to change, saved before each change. If the process dies
// (so no rollback runs), the next operation undoes it, or finishes it once it committed.
export function createJournal(options: AgentOptions) {
  const file = journalPath(options);
  const state: Journal = {
    version: 1,
    writes: [],
    linked: [],
    removedLinks: [],
    issued: [],
    issuing: [],
    retired: [],
    cleanup: [],
    committed: false,
  };
  let saved: string | null = null;
  const save = () => {
    const text = JSON.stringify(state) + '\n';
    writeAtomic(file, text, saved);
    saved = text;
  };
  return {
    write(target: string, before: string | null, after: string, owner?: WriteOwner) {
      state.writes.push({
        file: target,
        before,
        afterHash: hash(after),
        ...(owner ? { owner } : {}),
      });
      save();
    },
    link(link: string) {
      state.linked.push(link);
      save();
    },
    unlink(link: string) {
      state.removedLinks.push(link);
      save();
    },
    issuing(label: string) {
      state.issuing.push(label);
      save();
    },
    issue(label: string, id: string) {
      state.issuing.splice(state.issuing.indexOf(label), 1);
      state.issued.push(id);
      save();
    },
    commit(retired: Retired[], cleanup: { file: string; hash: string }[]) {
      Object.assign(state, { retired, cleanup, committed: true });
      save();
    },
    clear() {
      if (saved !== null) unlinkSync(file);
      saved = null;
    },
  };
}

function invalid(file: string, why: string): never {
  throw new Error(
    `AGENT_JOURNAL_INVALID: ${file}: ${why}. Check what it names, then delete it to continue.`,
  );
}

// Refuses a journal that names anything this installation would not write: a planted journal
// must not turn the next install into a write or delete of an arbitrary file.
function checkJournal(options: AgentOptions, file: string, value: unknown): Journal {
  const journal = value as Journal;
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === 'string');
  if (
    !journal ||
    journal.version !== 1 ||
    !Array.isArray(journal.writes) ||
    ![journal.linked, journal.removedLinks, journal.issued, journal.issuing ?? []].every(strings) ||
    !Array.isArray(journal.retired ?? []) ||
    !Array.isArray(journal.cleanup ?? [])
  )
    invalid(file, 'unreadable');
  const { manifest, skill } = locations(options);
  const credentials = path.join(options.stateDir, 'agent-credentials');
  const location = (target: AgentTarget, scope: AgentScope, root?: string) => {
    try {
      return agentLocation(target, options.home, options.env, scope, root);
    } catch {
      return null;
    }
  };
  const user = AGENT_TARGETS.map((target) => location(target, 'user'));
  const links = new Set(
    user.flatMap(
      (entry) => entry?.skills.map((folder) => path.join(folder, options.product)) ?? [],
    ),
  );
  const credential = (target: string) =>
    path.dirname(target) === credentials &&
    /^[a-z-]+-[0-9a-f-]{36}\.json$/.test(path.basename(target));
  const fixed = (target: string) =>
    target === manifest || target === path.join(skill, 'SKILL.md') || credential(target);
  for (const entry of journal.writes) {
    if (typeof entry?.file !== 'string' || typeof entry.afterHash !== 'string')
      invalid(file, 'write');
    if (entry.before !== null && typeof entry.before !== 'string') invalid(file, 'write');
    if (fixed(entry.file)) continue;
    const owner = entry.owner;
    const root = owner?.scope === 'workspace' ? owner.root : undefined;
    if (
      !owner ||
      !AGENT_TARGETS.includes(owner.target) ||
      (owner.scope !== 'user' && owner.scope !== 'workspace') ||
      (owner.scope === 'workspace' &&
        (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root)) ||
      location(owner.target, owner.scope, root)?.config !== entry.file
    )
      invalid(file, `unexpected file ${entry.file}`);
  }
  for (const link of [...journal.linked, ...journal.removedLinks])
    if (!links.has(link)) invalid(file, `unexpected link ${link}`);
  for (const item of [...(journal.retired ?? []), ...(journal.cleanup ?? [])])
    if (!fixed(item?.file) || typeof item.hash !== 'string') invalid(file, 'cleanup');
  return journal;
}

function removeIfUnchanged(target: string, expected: string): void {
  const text = readText(target);
  if (text !== null && hash(text) === expected) unlinkSync(target);
}

export async function recoverJournal(options: AgentOptions): Promise<string[]> {
  const file = journalPath(options);
  let raw: string | null;
  let parsed: unknown;
  try {
    raw = readText(file);
    parsed = raw === null ? null : JSON.parse(raw);
  } catch (error) {
    invalid(file, (error as Error).message);
  }
  if (raw === null) return [];
  const journal = checkJournal(options, file, parsed);
  const { skill } = locations(options);
  const orphans = (journal.issuing ?? []).map(
    (label) =>
      `recovered: a credential named ${label} may have been created without a record; revoke it in Aevra settings if it is listed`,
  );
  if (journal.committed) {
    const failed: string[] = [];
    for (const item of journal.retired ?? [])
      try {
        await options.credentials.revoke(item.id);
        removeIfUnchanged(item.file, item.hash);
      } catch {
        failed.push(item.id);
      }
    // Kept while a revocation fails, so the next operation tries those ids again.
    if (failed.length)
      throw new Error(
        `AGENT_REVOKE_INCOMPLETE: revoke credentials ${failed.join(', ')} (pending in ${file})`,
      );
    for (const item of journal.cleanup ?? []) removeIfUnchanged(item.file, item.hash);
    unlinkSync(file);
    return [`recovered: finished an interrupted ${options.product} operation`, ...orphans];
  }
  const written = (target: string, afterHash: string) => {
    const text = readText(target);
    return text !== null && hash(text) === afterHash ? text : null;
  };
  for (const entry of [...journal.writes].reverse()) {
    const text = written(entry.file, entry.afterHash);
    if (text === null) continue;
    if (entry.before === null) unlinkSync(entry.file);
    else writeAtomic(entry.file, entry.before, text);
  }
  for (const link of journal.linked)
    if (linkState(link, skill) === 'owned') removeSkillLink(link, skill);
  for (const link of journal.removedLinks)
    if (linkState(link, skill) === 'missing') createSkillLink(link, skill);
  for (const id of journal.issued)
    await options.credentials.revoke(id).catch((error: Error) => {
      throw new Error(
        `AGENT_REVOKE_INCOMPLETE: revoke credential ${id} (pending in ${file}): ${error.message}`,
      );
    });
  unlinkSync(file);
  return [
    `recovered: undid an interrupted ${options.product} operation and revoked ${journal.issued.length} unused credential(s)`,
    ...orphans,
  ];
}
