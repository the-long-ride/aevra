import { parse } from 'jsonc-parser';

// Forward slashes, no trailing separator (a bare root such as `/` or `F:/` keeps one).
function forwardSlashes(value: string): string {
  const text = value.replaceAll('\\', '/');
  const trimmed = text.replace(/\/+$/, '');
  if (trimmed === '') return text ? '/' : '';
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed;
}

// No trailing `/` (a bare `/` stays). A backslash is an ordinary character outside Windows.
const trimSlashes = (value: string): string => value.replace(/(?<=.)\/+$/, '');

// Paths compare equal when they differ only in case, slash direction or a trailing separator.
export const loosePath = (value: string): string => forwardSlashes(value).toLowerCase();

// True where file systems usually ignore case (win32, darwin): the one platform rule every path
// comparison of the engine uses.
export const foldsCase = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'win32' || platform === 'darwin';

// Identity of a workspace root: loose where file systems usually ignore case (win32, darwin),
// exact elsewhere, where `/src/Proj` and `/src/proj` are different folders.
export const rootKey = (value: string, platform: NodeJS.Platform = process.platform): string =>
  foldsCase(platform) ? loosePath(value) : value;

// Comparison form of a Claude project key: slash direction is ignored on win32 only, case on
// win32 and darwin only; elsewhere keys must match exactly (apart from a trailing `/`).
export function projectKeyMatch(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') return loosePath(value);
  const trimmed = trimSlashes(value);
  return platform === 'darwin' ? trimmed.toLowerCase() : trimmed;
}

// Claude Code stores per-project settings under `projects[<path>]` in ~/.claude.json. The same
// folder can appear in another spelling (on Windows `F:\x` or `F:/x` in any case), so reuse the
// key already present when the platform treats both spellings as one folder.
export function resolveClaudeProjectKey(
  configText: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const config = parse(configText || '{}', [], { allowTrailingComma: true });
  const projects =
    config && typeof config === 'object' && Object.hasOwn(config, 'projects')
      ? config.projects
      : undefined;
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    const keys = Object.keys(projects);
    if (keys.includes(root)) return root;
    const wanted = projectKeyMatch(root, platform);
    const match = keys.find((key) => projectKeyMatch(key, platform) === wanted);
    if (match !== undefined) return match;
  }
  return platform === 'win32' ? forwardSlashes(root) : trimSlashes(root);
}
