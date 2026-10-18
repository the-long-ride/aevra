import { unlinkSync } from 'node:fs';
import path from 'node:path';
import type { AgentManifest, AgentOptions, Registration } from './types.js';
import { hash, readText } from './files.js';
import { locations } from './manage-plan.js';
import { removeEmpty } from './skills.js';

// Everything here runs after the manifest is committed and never triggers a rollback: the
// committed manifest already describes the result, so a failure is reported instead.

function attempt(notes: string[], what: string, step: () => void): void {
  try {
    step();
  } catch {
    notes.push(`cleanup: could not remove ${what}`);
  }
}

// Removes what the committed manifest no longer names. Credential file paths stay out of notes.
export function cleanupCommitted(
  options: AgentOptions,
  manifest: AgentManifest,
  retired: Registration[],
  touchesUser: boolean,
): string[] {
  const paths = locations(options);
  const notes: string[] = [];
  for (const reg of retired)
    attempt(notes, 'a retired credential file', () => {
      // A credential file the user changed stays (planOne reported it); its token is revoked.
      const text = readText(reg.credentialFile);
      if (text !== null && hash(text) === reg.credentialHash) unlinkSync(reg.credentialFile);
    });
  if (touchesUser && !manifest.registrations.some((reg) => reg.scope === 'user'))
    attempt(notes, `the skill folder ${paths.skill}`, () => {
      const file = path.join(paths.skill, 'SKILL.md');
      const text = readText(file);
      if (text !== null && hash(text) === manifest.skillHash) unlinkSync(file);
      removeEmpty(paths.skill);
    });
  if (manifest.registrations.length === 0) {
    attempt(notes, 'the empty integration manifest', () => unlinkSync(paths.manifest));
    attempt(notes, 'the empty credential folder', () =>
      removeEmpty(path.join(options.stateDir, 'agent-credentials')),
    );
  }
  return notes;
}

// Revokes the retired credentials once nothing on disk names them. A failure leaves the files as
// committed and names the credential ids (connector ids, not secrets) still to revoke.
export async function revokeRetired(options: AgentOptions, retired: Registration[]) {
  const failed: string[] = [];
  for (const reg of retired)
    try {
      await options.credentials.revoke(reg.credentialId);
    } catch {
      failed.push(reg.credentialId);
    }
  if (failed.length)
    throw new Error(`AGENT_REVOKE_INCOMPLETE: revoke credentials ${failed.join(', ')}`);
}
