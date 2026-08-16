import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CommandInput, ProcessLifecycle } from '../../protocol/src/index.js';
import { redactText } from '../../security/src/dlp.js';

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
  marker?: string;
  logPath?: string;
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
    const entry: Entry = { id, command, cwd, lifecycle, child, log, startedAt: new Date().toISOString() };
    this.entries.set(id, entry);
    return { processId: id, pid: child.pid!, startedAt: entry.startedAt };
  }

  private startKeepRunning(command: CommandInput, cwd: string) {
    if (!this.processHostEntry || !this.logDir) {
      throw new Error('keep-running process host is not configured');
    }
    mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    const id = `proc_${randomUUID()}`;
    const marker = `aevra-proc-${randomUUID()}`;
    const logPath = path.join(this.logDir, `${id}.log`);
    const startedAt = new Date().toISOString();
    const encoded = Buffer.from(JSON.stringify({ ...command, cwd }), 'utf8').toString('base64url');
    const child = spawn(process.execPath, [this.processHostEntry, '--aevra-marker', marker], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        AEVRA_PROCESS_COMMAND: encoded,
        AEVRA_PROCESS_LOG: logPath,
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
      marker,
      logPath,
    };
    this.entries.set(id, entry);
    return { processId: id, pid: child.pid!, startedAt, marker, logPath };
  }

  list() {
    return [...this.entries.values()].map((entry) => ({
      processId: entry.id,
      pid: entry.child.pid,
      startedAt: entry.startedAt,
      lifecycle: entry.lifecycle,
      running: entry.child.exitCode === null,
      ...(entry.marker ? { marker: entry.marker } : {}),
      ...(entry.logPath ? { logPath: entry.logPath } : {}),
    }));
  }

  logs(id: string, cursor = 0) {
    const entry = this.required(id);
    if (entry.logPath) {
      try {
        const text = readFileSync(entry.logPath, 'utf8');
        const secrets = Object.values(entry.command.env);
        const redacted = this.redact(redactText(text, secrets).text);
        const lines = redacted.split(/\r?\n/).filter(Boolean);
        const bounded = lines.slice(-500);
        return { cursor: bounded.length, lines: bounded.slice(cursor) };
      } catch {
        return { cursor: 0, lines: [] };
      }
    }
    return entry.log.read(cursor);
  }

  stop(id: string) {
    const entry = this.required(id);
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
      if (entry.lifecycle === 'stop-with-aevra' && entry.child.exitCode === null) entry.child.kill('SIGTERM');
    }
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
