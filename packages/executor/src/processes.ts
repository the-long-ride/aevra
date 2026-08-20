import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CommandInput,
  ManagedProcessState,
  ManagedProcessStatus,
  ProcessLifecycle,
} from '../../protocol/src/index.js';
import { redactText } from '../../security/src/dlp.js';

const MAX_WAIT_MS = 30_000;

export class BoundedLog {
  private lines: string[] = [];
  constructor(private maxLines = 500) {}
  append(text: string) {
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      this.lines.push(line);
      while (this.lines.length > this.maxLines) this.lines.shift();
    }
  }
  read(cursor = 0) {
    return { cursor: this.lines.length, lines: this.lines.slice(cursor) };
  }
}

interface Entry {
  id: string;
  command: CommandInput;
  cwd: string;
  lifecycle: ProcessLifecycle;
  child: ChildProcess;
  log: BoundedLog;
  startedAt: string;
  state: ManagedProcessState;
  exitCode: number | null;
  signal: string | null;
  finishedAt: string | null;
  stopRequested: boolean;
  marker?: string;
  logPath?: string;
  resultPath?: string;
}

interface PersistedProcessResult {
  state: ManagedProcessState;
  exitCode: number | null;
  signal: string | null;
  finishedAt: string;
}

export interface ManagedProcessRuntimeOptions {
  redact?: (value: string) => string;
  processHostEntry?: string;
  logDir?: string;
}

export class ManagedProcessRuntime {
  private entries = new Map<string, Entry>();
  private readonly redact: (value: string) => string;
  private readonly processHostEntry?: string;
  private readonly logDir?: string;

  constructor(options: ManagedProcessRuntimeOptions | ((value: string) => string) = {}) {
    if (typeof options === 'function') {
      this.redact = options;
      return;
    }
    this.redact = options.redact ?? ((value) => value);
    this.processHostEntry = options.processHostEntry;
    this.logDir = options.logDir;
  }

  start(command: CommandInput, cwd: string, lifecycle: ProcessLifecycle) {
    if (lifecycle === 'keep-running') return this.startKeepRunning(command, cwd);
    return this.startAttached(command, cwd, lifecycle);
  }

  private startAttached(command: CommandInput, cwd: string, lifecycle: ProcessLifecycle) {
    const secrets = Object.values(command.env);
    const redact = (value: string) => this.redact(redactText(value, secrets).text);
    const id = `proc_${randomUUID()}`;
    const child = spawn(command.executable, command.args, {
      cwd,
      env: { ...process.env, ...command.env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = new BoundedLog();
    child.stdout?.on('data', (b) => log.append(redact(String(b))));
    child.stderr?.on('data', (b) => log.append(redact(String(b))));
    const entry: Entry = {
      id,
      command,
      cwd,
      lifecycle,
      child,
      log,
      startedAt: new Date().toISOString(),
      state: 'running',
      exitCode: null,
      signal: null,
      finishedAt: null,
      stopRequested: false,
    };
    child.once('exit', (code, signal) => this.complete(entry, code, signal));
    this.entries.set(id, entry);
    return this.statusValue(entry);
  }

  private startKeepRunning(command: CommandInput, cwd: string) {
    if (!this.processHostEntry || !this.logDir) {
      throw new Error('keep-running process host is not configured');
    }
    mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    const id = `proc_${randomUUID()}`;
    const marker = `aevra-proc-${randomUUID()}`;
    const logPath = path.join(this.logDir, `${id}.log`);
    const resultPath = `${logPath}.result.json`;
    const startedAt = new Date().toISOString();
    const encoded = Buffer.from(JSON.stringify({ ...command, cwd }), 'utf8').toString('base64url');
    const child = spawn(process.execPath, [this.processHostEntry, '--aevra-marker', marker], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        AEVRA_PROCESS_COMMAND: encoded,
        AEVRA_PROCESS_LOG: logPath,
        AEVRA_PROCESS_RESULT: resultPath,
        AEVRA_PROCESS_MARKER: marker,
      },
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    const entry: Entry = {
      id,
      command,
      cwd,
      lifecycle: 'keep-running',
      child,
      log: new BoundedLog(),
      startedAt,
      state: 'running',
      exitCode: null,
      signal: null,
      finishedAt: null,
      stopRequested: false,
      marker,
      logPath,
      resultPath,
    };
    this.entries.set(id, entry);
    return this.statusValue(entry);
  }

  list() {
    return [...this.entries.values()].map((entry) => {
      this.refreshDetachedResult(entry);
      return this.statusValue(entry);
    });
  }

  status(id: string): ManagedProcessStatus {
    const entry = this.required(id);
    this.refreshDetachedResult(entry);
    return this.statusValue(entry);
  }

  async wait(id: string, timeoutMs = 15_000): Promise<ManagedProcessStatus> {
    const waitMs = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 15_000, MAX_WAIT_MS));
    const deadline = Date.now() + waitMs;
    while (true) {
      const status = this.status(id);
      if (status.state !== 'running' || Date.now() >= deadline) return status;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))),
      );
    }
  }

  logs(id: string, cursor = 0) {
    const entry = this.required(id);
    this.refreshDetachedResult(entry);
    let chunk: { cursor: number; lines: string[] };
    if (entry.logPath) {
      try {
        const text = readFileSync(entry.logPath, 'utf8');
        const secrets = Object.values(entry.command.env);
        const redacted = this.redact(redactText(text, secrets).text);
        const lines = redacted.split(/\r?\n/).filter(Boolean);
        const bounded = lines.slice(-500);
        chunk = { cursor: bounded.length, lines: bounded.slice(cursor) };
      } catch {
        chunk = { cursor: 0, lines: [] };
      }
    } else {
      chunk = entry.log.read(cursor);
    }
    const status = this.statusValue(entry);
    return {
      processId: id,
      ...chunk,
      state: status.state,
      exitCode: status.exitCode,
      signal: status.signal,
      finishedAt: status.finishedAt,
      eof: status.state !== 'running',
    };
  }

  stop(id: string) {
    const entry = this.required(id);
    entry.stopRequested = true;
    if (entry.child.exitCode === null) entry.child.kill('SIGTERM');
    return { processId: id, stopped: true };
  }

  restart(id: string) {
    const entry = this.required(id);
    this.stop(id);
    this.entries.delete(id);
    return this.start(entry.command, entry.cwd, entry.lifecycle);
  }

  stopWithAevra() {
    for (const entry of this.entries.values()) {
      if (entry.lifecycle === 'stop-with-aevra' && entry.child.exitCode === null) {
        entry.stopRequested = true;
        entry.child.kill('SIGTERM');
      }
    }
  }

  private complete(entry: Entry, code: number | null, signal: string | null) {
    entry.exitCode = code;
    entry.signal = signal;
    entry.finishedAt = new Date().toISOString();
    entry.state = entry.stopRequested ? 'stopped' : code === 0 ? 'completed' : 'failed';
  }

  private refreshDetachedResult(entry: Entry) {
    if (!entry.resultPath || entry.state !== 'running') return;
    try {
      const result = JSON.parse(readFileSync(entry.resultPath, 'utf8')) as PersistedProcessResult;
      if (!result.finishedAt) return;
      entry.state = result.state;
      entry.exitCode = result.exitCode;
      entry.signal = result.signal;
      entry.finishedAt = result.finishedAt;
    } catch {
      // The helper is still running, or the atomic result sidecar is not visible yet.
    }
  }

  private statusValue(entry: Entry): ManagedProcessStatus {
    const durationMs = entry.finishedAt
      ? Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt))
      : null;
    return {
      processId: entry.id,
      pid: entry.child.pid ?? 0,
      startedAt: entry.startedAt,
      lifecycle: entry.lifecycle,
      state: entry.state,
      exitCode: entry.exitCode,
      signal: entry.signal,
      finishedAt: entry.finishedAt,
      durationMs,
      ...(entry.marker ? { marker: entry.marker } : {}),
      ...(entry.logPath ? { logPath: entry.logPath } : {}),
      ...(entry.resultPath ? { resultPath: entry.resultPath } : {}),
    };
  }

  private required(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('managed process not found');
    return entry;
  }
}

export interface ProcessIdentityRecord {
  helperPid: number;
  helperStartedAt: string;
  marker: string;
}

export function verifyReAdoption(
  record: ProcessIdentityRecord,
  observed: { pid: number; startedAt: string; commandLine: string },
) {
  return (
    record.helperPid === observed.pid &&
    record.helperStartedAt === observed.startedAt &&
    observed.commandLine.includes(record.marker)
  );
}
