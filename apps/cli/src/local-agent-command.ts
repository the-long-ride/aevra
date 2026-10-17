import { readFileSync } from 'node:fs';
import { runStdio } from '../../../packages/agent-integration/src/stdio.js';
import {
  httpTransport,
  readCredential,
} from '../../../packages/agent-integration/src/stdio-http.js';

// A usage error is the user's typo, not a sign that core is down.
export class AgentUsageError extends Error {}

const SERVE_USAGE = 'Usage: aevra agent serve --credential-file <managed credential file>';

export interface LocalAgentDependencies {
  bridge(credentialFile: string): Promise<number>;
}

const defaults: LocalAgentDependencies = {
  async bridge(credentialFile) {
    const credential = readCredential(credentialFile);
    const ca = credential.caFile ? readFileSync(credential.caFile) : undefined;
    return runStdio(
      { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
      httpTransport(credential, ca),
    );
  },
};

// `agent serve` is the stdio bridge started by generated agent configs. It replaces
// `mcp serve --stdio`, which was never released and is not accepted.
function serveFile(argv: string[]): string | null {
  if (argv[0] !== 'agent' || argv[1] !== 'serve') return null;
  const [flag, file, ...extra] = argv.slice(2);
  if (flag !== '--credential-file' || !file || extra.length) throw new AgentUsageError(SERVE_USAGE);
  return file;
}

export async function runLocalAgentCommand(
  argv: string[],
  deps: LocalAgentDependencies = defaults,
): Promise<number | null> {
  const file = serveFile(argv);
  return file === null ? null : deps.bridge(file);
}
