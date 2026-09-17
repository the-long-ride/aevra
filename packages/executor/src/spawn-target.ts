import { existsSync } from 'node:fs';
import path, { delimiter } from 'node:path';

/**
 * Resolves a bare executable name against PATH the way a shell would, including
 * the PATHEXT suffixes Windows requires.
 *
 * `spawn(..., { shell: false })` does no PATH extension lookup, so on Windows
 * `npm`, `npx` and `pnpm` - which ship as `.cmd` shims, not `.exe` - fail with
 * ENOENT. Resolving here keeps `shell: false`, which matters: this path takes
 * model-supplied argv, and `shell: true` would hand that argv to a command
 * interpreter.
 */
export function resolveExecutable(executable: string, env: NodeJS.ProcessEnv = process.env) {
  if (executable.includes('/') || executable.includes('\\')) return executable;
  if (process.platform !== 'win32') return executable;
  if (path.extname(executable)) return executable;
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return executable;
}

/**
 * Arguments that cannot be quoted safely for cmd.exe. A double quote ends the
 * quoted run and `%NAME%` is expanded by the interpreter even inside quotes -
 * neither can be escaped reliably, so a command carrying them is refused rather
 * than silently mangled or, worse, split into extra commands.
 */
const CMD_UNQUOTABLE = /["%\r\n]/;

/**
 * Wraps a Windows `.cmd`/`.bat` shim in an explicit `cmd.exe /d /s /c` call.
 *
 * Node refuses to spawn a batch file without a shell (the CVE-2024-27980
 * mitigation) and answers EINVAL, so resolving `npm` to `npm.CMD` is not enough
 * on its own. `shell: true` would fix it by handing the whole argv to the
 * interpreter for re-parsing, which is exactly what must not happen to
 * model-supplied arguments - so the command line is built here with every
 * argument individually quoted, and anything unquotable is refused up front.
 *
 * Returns null when no wrapping is needed.
 */
export function windowsShimCommand(resolved: string, args: string[]) {
  const extension = path.extname(resolved).toLowerCase();
  if (process.platform !== 'win32' || (extension !== '.cmd' && extension !== '.bat')) return null;
  for (const argument of [resolved, ...args]) {
    if (CMD_UNQUOTABLE.test(argument)) {
      throw new Error(`argument cannot be passed safely to a Windows shim: ${argument}`);
    }
  }
  const line = [resolved, ...args].map((argument) => `"${argument}"`).join(' ');
  return {
    executable: process.env.ComSpec ?? 'cmd.exe',
    // /s takes the rest of the line verbatim after stripping the outer quote
    // pair, which is what keeps the per-argument quoting above intact.
    args: ['/d', '/s', '/c', `"${line}"`],
  };
}
