import { wrapUntrusted } from '../../security/src/untrusted.js';

export interface InstructionEntry {
  source: string;
  content: string;
}

/**
 * Renders merged AGENTS.md instructions for delivery as an MCP prompt.
 *
 * User-global instructions are operator-authored and pass through unchanged.
 * Workspace instructions come from repository files that an attacker may control
 * — cloning a hostile repo would otherwise place their text in the model's
 * highest-trust position — so they are delivered inside an untrusted envelope.
 */
export function renderInstructionPrompt(instructions: unknown, note?: unknown): string {
  const entries: InstructionEntry[] = Array.isArray(instructions)
    ? (instructions as InstructionEntry[])
    : [];
  const rendered = entries.map((instruction) => {
    const body = `# ${instruction.source} instructions\n\n${instruction.content}`;
    return instruction.source === 'user'
      ? body
      : wrapUntrusted(`${instruction.source} instructions`, body);
  });
  return rendered.join('\n\n---\n\n') || String(note ?? '') || 'No instruction files found.';
}
