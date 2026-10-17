import { existsSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AGENT_TARGETS,
  type AgentChange,
  type AgentOptions,
  type Registration,
  type AgentResult,
} from './types.js';
import { nativeEntry } from './adapters.js';
import { editConfig } from './config-edit.js';
import { operationNotes, plannedChange, refreshNotes } from './manage-change.js';
import { cleanupCommitted, revokeRetired } from './manage-finish.js';
import {
  loadManifest,
  locations,
  preflight,
  registrationState,
  resolveScope,
  sameRegistration,
  selectionsFor,
  type Planned,
} from './manage-plan.js';
import { gitContext } from './project-guard.js';
import {
  entryHash,
  hash,
  readText,
  rollbackFiles,
  writeAtomic,
  type WrittenFile,
} from './files.js';
import { createSkillLink, linkState, removeEmpty, removeSkillLink, skillText } from './skills.js';

export async function manageAgent(options: AgentOptions): Promise<AgentResult> {
  if (
    !['aevra', 'aevra-browser'].includes(options.product) ||
    !['stdio', 'http'].includes(options.transport) ||
    !['install', 'uninstall', 'status'].includes(options.operation) ||
    (options.target !== 'all' && !AGENT_TARGETS.includes(options.target))
  )
    throw new Error('AGENT_OPTIONS_INVALID');
  const targets = options.target === 'all' ? [...AGENT_TARGETS] : [options.target];
  const paths = locations(options);
  let manifest = loadManifest(options);
  if (options.operation === 'status')
    return {
      dryRun: false,
      registrations: manifest.registrations.map((reg) => ({
        ...reg,
        state: registrationState(options, manifest, reg),
      })),
      message: 'Agent integration status',
      notes: [],
      changes: [],
    };
  const install = options.operation === 'install';
  const resolved = resolveScope(options);
  // Git is located once per call (and folder), from the caller's environment.
  const git = gitContext(options.env);
  const plan = () =>
    preflight(options, manifest, selectionsFor(options, manifest, targets, resolved), install, git);
  const nothing = (planned: Planned[]) => !install && planned.every((item) => !item.previous);
  const removed = (planned: Planned[]) =>
    install ? {} : { removed: planned.filter((item) => item.previous).map((item) => item.target) };
  const none = `${options.product}: nothing to remove for ${targets.join(', ')} (not registered).`;
  if (options.dryRun) {
    const planned = plan();
    return {
      dryRun: true,
      registrations: manifest.registrations,
      message: nothing(planned)
        ? none
        : `Would ${options.operation} ${options.product} for ${targets.join(', ')} using ${options.transport}`,
      notes: [...refreshNotes(planned), ...operationNotes(options, planned, false, git)],
      changes: planned.flatMap((item) => plannedChange(options, item) ?? []),
      ...removed(planned),
    };
  }
  // Refuse before the lock folder exists, so a refusal leaves nothing behind. An install always
  // goes on, so only an uninstall plans here (an install plans once, inside the lock).
  if (!install && nothing(plan()))
    return {
      dryRun: false,
      registrations: manifest.registrations,
      message: none,
      notes: [],
      changes: [],
      removed: [],
    };
  // An install plans only inside the lock: folders made for the lock go again if it is refused.
  const madeForLock = [path.dirname(paths.folder), paths.folder].filter((dir) => !existsSync(dir));
  mkdirSync(paths.folder, { recursive: true, mode: 0o700 });
  let fd: number;
  try {
    fd = openSync(paths.lock, 'wx', 0o600);
  } catch {
    throw new Error('AGENT_INSTALL_BUSY: another integration operation holds the lock');
  }
  const writes: WrittenFile[] = [];
  const linked: string[] = [];
  const issued: string[] = [];
  const removedLinks: string[] = [];
  const write = (file: string, after: string, before = readText(file)) => {
    writeAtomic(file, after, before);
    writes.push({ file, before, after });
  };
  // Two registrations can share one file (Claude user and project entries): chain the edits.
  const current = (item: Planned) =>
    [...writes].reverse().find((entry) => entry.file === item.location.config)?.after ?? item.text;
  const writeEntry = (item: Planned, entry?: Record<string, unknown>) => {
    const before = current(item);
    const { kind, entryPath } = item.location;
    const after = editConfig(before ?? '', kind, entryPath, options.product, entry);
    write(item.location.config, after, before);
  };
  // Every config edit, then the manifest write: the only part a failure rolls back. No
  // credential is revoked in here, so a rollback never restores an entry naming a revoked one.
  const commit = async () => {
    manifest = loadManifest(options);
    const planned = plan();
    const originalManifest = readText(paths.manifest);
    // Uninstall touches user scope only through a user registration (as `preflight` checks it).
    const touchesUser = planned.some(
      (item) => item.scope === 'user' && (install || item.previous !== undefined),
    );
    const refreshed = refreshNotes(planned);
    const retired: Registration[] = [];
    const changes: AgentChange[] = [];
    if (install) {
      if (touchesUser) {
        // Probe link support before credentials/configuration mutations.
        mkdirSync(paths.skill, { recursive: true, mode: 0o700 });
        const probe = path.join(paths.folder, `link-probe-${randomUUID()}`);
        try {
          createSkillLink(probe, paths.skill);
        } catch (error) {
          throw new Error(
            `AGENT_LINK_UNAVAILABLE: enable symbolic links or directory junctions: ${(error as Error).message}`,
          );
        } finally {
          removeSkillLink(probe, paths.skill);
        }
        const source = skillText(options.product);
        write(path.join(paths.skill, 'SKILL.md'), source);
        manifest.skillHash = hash(source);
      }
      for (const item of planned) {
        for (const link of item.links)
          if (linkState(link, paths.skill) === 'missing') {
            createSkillLink(link, paths.skill);
            linked.push(link);
          }
        const change = plannedChange(options, item);
        if (item.refresh) {
          // Same credential, new launcher or endpoint: rewrite in place, record the new hashes.
          const { entry, secret } = item.refresh;
          if (entry) writeEntry(item, entry);
          if (secret) write(item.previous!.credentialFile, secret);
          if (change) changes.push(change);
          manifest.registrations = manifest.registrations.map((reg) =>
            sameRegistration(reg, item)
              ? {
                  ...reg,
                  config: item.location.config,
                  entryPath: item.location.entryPath,
                  entryHash: entry ? entryHash(entry) : reg.entryHash,
                  credentialHash: secret ? hash(secret) : reg.credentialHash,
                  links: item.links,
                }
              : reg,
          );
          continue;
        }
        if (!change) continue;
        const credential = await options.credentials.create(`${options.product}:${item.target}`);
        issued.push(credential.id);
        const credentialFile = path.join(
          options.stateDir,
          'agent-credentials',
          `${item.target}-${randomUUID()}.json`,
        );
        const secret =
          JSON.stringify({
            version: 1,
            id: credential.id,
            token: credential.token,
            endpoint: options.endpoint,
            ...(options.caFile ? { caFile: options.caFile } : {}),
          }) + '\n';
        write(credentialFile, secret, null);
        const entry = nativeEntry(options, item.target, credentialFile, credential);
        writeEntry(item, entry);
        changes.push(change);
        if (item.previous) retired.push(item.previous);
        manifest.registrations = manifest.registrations.filter(
          (reg) => !sameRegistration(reg, item),
        );
        manifest.registrations.push({
          target: item.target,
          scope: item.scope,
          ...(item.scope === 'workspace' ? { workspaceRoot: item.root } : {}),
          transport: options.transport,
          config: item.location.config,
          entryPath: item.location.entryPath,
          entryHash: entryHash(entry),
          credentialId: credential.id,
          credentialFile,
          credentialHash: hash(secret),
          links: item.links,
        });
      }
    } else {
      for (const item of planned) {
        if (!item.previous) continue;
        const change = plannedChange(options, item);
        if (change) {
          writeEntry(item);
          changes.push(change);
        }
        for (const link of item.previous.links)
          if (linkState(link, paths.skill) === 'owned') {
            removeSkillLink(link, paths.skill);
            removedLinks.push(link);
          }
        retired.push(item.previous);
        manifest.registrations = manifest.registrations.filter(
          (reg) => !sameRegistration(reg, item),
        );
      }
    }
    write(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', originalManifest);
    return { planned, retired, changes, touchesUser, refreshed };
  };
  const rollback = async (error: unknown): Promise<never> => {
    rollbackFiles(writes);
    for (const link of linked) removeSkillLink(link, paths.skill);
    for (const link of removedLinks)
      if (linkState(link, paths.skill) === 'missing') createSkillLink(link, paths.skill);
    const failed: string[] = [];
    for (const id of issued)
      try {
        await options.credentials.revoke(id);
      } catch {
        failed.push(id);
      }
    removeEmpty(paths.skill);
    removeEmpty(path.join(options.stateDir, 'agent-credentials'));
    if (failed.length)
      throw new Error(
        `AGENT_ROLLBACK_INCOMPLETE: revoke credentials ${failed.join(', ')}; ${(error as Error).message}`,
      );
    throw error;
  };
  try {
    const { planned, retired, changes, touchesUser, refreshed } = await commit().catch(rollback);
    // Committed. Cleanup, the git exclude and the revocation of retired credentials are best
    // effort from here on: a failure is a note (or, for a revocation, an error naming the ids)
    // and never a rollback.
    const notes = [
      ...refreshed,
      ...operationNotes(options, planned, true, git),
      ...cleanupCommitted(options, manifest, retired, touchesUser),
    ];
    await revokeRetired(options, retired);
    return {
      dryRun: false,
      registrations: manifest.registrations,
      message: `${options.product}: ${options.operation} complete. Refresh or restart the agent to apply.`,
      notes,
      changes,
      ...removed(planned),
    };
  } finally {
    closeSync(fd);
    unlinkSync(paths.lock);
    for (const dir of madeForLock.reverse())
      try {
        removeEmpty(dir);
      } catch {
        // Left for the next operation: an empty folder is harmless.
      }
  }
}
