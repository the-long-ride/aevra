# Workspace Manifest (`aevra.json`) — Design

Date: 2026-09-12 (revised 2026-09-14 — see §12)
Status: design, pending implementation plan

## 1. Goal

First piece of the parked MCP-interop roadmap. Two problems, one file:

- An agent connected to Aevra guesses `npm test` vs `pnpm test` vs `cargo test`
  per workspace. It should be told.
- `classifySensitivity()` (`packages/security/src/sensitive.ts`) already accepts a
  `userPatterns` hook for operator-declared sensitive/secret paths, but nothing in
  the codebase populates it — the production enforcement path,
  `SecurityGuard.authorizeResource` (`apps/core/src/security/security-guard.ts`),
  calls `classifySensitivity({ path })` with no patterns at all. An operator has no
  way to declare "never let the agent touch this" beyond the hardcoded defaults.

Done looks like: a workspace with an `aevra.json` at its root gets its declared
commands surfaced to any connected client, and its declared paths actually gated
— not just documented — through the security machinery every other file operation
already goes through.

## 2. Non-goals

- No `downstreamMcpServers` or `toolsetProfile` fields. Those belong to the MCP
  gateway and toolset-profile subsystems, neither of which exists yet. Adding
  schema fields for consumers that don't exist is speculative; YAGNI.
- No data-connection declarations (SQL/sheets) — parked separately, low priority.
- No auto-detection of package manager from lockfiles. Nothing in the repo does
  this today (checked); the manifest declares commands explicitly instead.
- No templating or variable substitution in command strings. A command is a
  literal string surfaced to the client as text, run (if at all) through the
  normal `shell_run` path with normal risk tiering — see §6 and §11.
- No TOML. Root `package.json` has zero runtime dependencies today (checked —
  only `devDependencies`); a TOML parser would be the product's first one. Plain
  JSON matches the existing house style (hand-rolled WS server, hand-rolled DLP,
  `node:sqlite` instead of an ORM) at zero cost.
- No general-purpose glob engine (no brace expansion, character classes, or
  negation) — see §5.
- No mitigation for deleting an _unlisted ancestor_ of a protected path (e.g.
  protecting `vendor/keys/**` but not `vendor` itself) — see §11.

## 3. Schema

`<workspaceRoot>/aevra.json`, both top-level fields optional:

```json
{
  "commands": {
    "test": "pnpm test",
    "build": "pnpm build",
    "lint": "pnpm lint",
    "run": "pnpm start"
  },
  "protectedPaths": {
    "sensitive": ["config/local.json", "*.local.*"],
    "secret": ["vendor/private-keys/**"]
  }
}
```

An absent file behaves almost exactly as today: no commands surfaced, no
operator-declared patterns fed to `classifySensitivity`. The one addition that
applies even with no file present is the implicit self-protection pattern for
`aevra.json` itself — see §4.2. Every already-registered workspace keeps
working unchanged otherwise.

`protectedPaths` has two buckets rather than one flat list, because
`classifySensitivity`'s `userPatterns` type already supports a per-pattern class
(`SECRET` | `SENSITIVE`) and the two have different real effects: `secret` denies
outright on every operation; `sensitive` requires approval on mutation and allows
on read, identically to how a hardcoded pattern like `.npmrc` behaves today. No
change to `authorizeResource`'s decision logic — only to what feeds it.

`classifySensitivity` returns on the **first** matching `userPatterns` rule
(`packages/security/src/sensitive.ts`):

```ts
for (const rule of input.userPatterns ?? []) if (rule.pattern.test(input.path)) return rule.class;
```

So pattern order matters. `ManifestService` must emit every `secret`-bucket
pattern before any `sensitive`-bucket pattern — otherwise a path matching both
a `sensitive` glob and a stricter `secret` glob would be downgraded to
`SENSITIVE` (readable) instead of denied, whichever bucket happened to be
declared or iterated first.

## 4. Loading

New `apps/core/src/workspaces/manifest-service.ts`, mirroring the existing
`SkillsService.instructions()` pattern (`apps/core/src/skills/skills-service.ts`):
synchronous `fs`, 256KB size cap (the same `FILE_CAP_BYTES` skills-service
already defines). Unlike `SkillsService`, reads are **cached** per `hostRoot`,
keyed on the file's `mtimeMs` + `size` from a single `statSync` call: on every
`read()`, stat the file, and if a cached entry matches that `mtimeMs`/`size`
return it without re-reading or re-parsing. `authorizeResource` — unlike
`SkillsService.instructions()`, which is called roughly once per prompt fetch —
is on the hot path of every single file operation, including each item of a
30-path `file_read_many`; re-reading and re-compiling every glob on every call
is real, avoidable cost. The cache still reflects a live edit to `aevra.json`
within one more `statSync` call, so nothing needs an explicit invalidation
hook.

```ts
export interface ManifestResult {
  commands: Record<string, string>;
  protectedPatterns: Array<{ pattern: RegExp; class: 'SENSITIVE' | 'SECRET' }>;
  warning: string | null;
}

export class ManifestService {
  read(workspaceRoot: string | null): ManifestResult;
  summarize(workspaceRoot: string | null): ManifestSummary; // see §6
}
```

`apps/core` reading a workspace-root file directly via `node:fs` is not a new
boundary crossing: `SkillsService` already does this for `AGENTS.md` /
`CLAUDE.md`.

### 4.1 Malformed file

This is the one place this design deliberately diverges from
`SkillsService.instructions()`, which silently swallows a non-`AevraToolError`
read failure. A manifest feeds security enforcement, so silent swallowing is a
real footgun: an operator edits `protectedPaths`, makes a JSON typo, and
protection silently vanishes with zero signal.

So: a parse failure does not block `workspace_select` — too harsh a consequence
for a config typo — but it is never silent. `ManifestResult.warning` carries the
message, `protectedPatterns` falls back to just the implicit self-protection
pattern from §4.2, and `commands` to `{}` for that read. This applies uniformly
to every failure mode — missing file, malformed JSON, and an oversized file all
return through the same "defaults + optional warning" shape; none of them throw.
The warning surfaces through `workspace_current` / `workspace_select` (§6) so a
client can see it rather than wonder why a path is suddenly reachable.

An invalid individual glob (fails to compile, §5) is handled the same way at
pattern granularity: that one pattern is dropped and named in `warning`, the
rest of the file still loads.

### 4.2 Self-protection

`ManifestService` always includes one implicit pattern matching `aevra.json`
itself at the workspace root, classified `SENSITIVE` — added unconditionally,
not only when a manifest already exists. Without this, an agent could silently
disarm every declared protection with two ordinary tool calls: overwrite
`aevra.json` with `{}`, then read whatever `protectedPaths` used to cover — the
second call would see an empty `protectedPatterns` list because the file that
would have populated it had just been erased. Because the pattern applies even
before `aevra.json` exists, the very first `file_write` that _creates_ it is
also gated (approval-required), not just later edits.

`SENSITIVE` rather than `SECRET`: the manifest's `commands` are meant to be
readable (that is the whole point of §1), so read access stays open; only a
mutation — create, write, patch, move, delete — requires approval.

## 5. Glob compiler

No glob utility exists anywhere in the repo today (checked — no `minimatch`
dependency, no hand-rolled equivalent). New `packages/security/src/glob.ts`:

```ts
export function compileGlob(pattern: string): RegExp | null;
```

Supports `*` (any characters except a path separator), `**` (any characters
including separators, including none), and literal characters escaped for
`RegExp`. Two suffix/prefix forms get dedicated handling because the naive
expansion is wrong for both:

- A pattern ending in `/**` (e.g. `vendor/keys/**`) also matches the directory
  itself with no suffix at all (`vendor/keys`), not only paths strictly inside
  it. Otherwise a recursive delete of exactly `vendor/keys` — logical path
  `vendor/keys`, no trailing slash — would not match and would be silently
  allowed, destroying the very thing the pattern was declared to protect.
- A pattern starting with `**/` (e.g. `**/id_rsa`) also matches at depth zero
  (`id_rsa`), not only nested occurrences.

Matching is anchored to the full path, matching how `userPatterns` is already
consumed — `rule.pattern.test(input.path)` against `input.logicalPath` exactly
as the tool call supplied it, which is **not** normalized before this test
(`classifySensitivity` only lowercases and normalizes separators for its own
hardcoded checks, further down the same function, after `userPatterns` has
already run). So the compiled regex itself has to tolerate what a real
`logicalPath` actually looks like:

- An optional single leading `/` — MCP clients commonly pass paths as
  `/config/local.json`; a pattern written as `config/local.json` must still
  match.
- Either `/` or `\` as a path separator, since Windows-style paths are the
  norm on this host.
- Case-insensitive matching, since NTFS is case-insensitive and the hardcoded
  checks lower-case for the same reason.

Without all three, a manifest-declared pattern can silently fail to match its
intended target and provide zero protection while still reporting success at
load time — worse than an error, because nothing surfaces it.

Deliberately not a general-purpose glob engine (no brace expansion, no
character classes, no negation) — those add real parsing surface for a feature
whose whole point is a short, auditable path list. If a pattern doesn't compile
(unbalanced input, or the empty string), it is dropped per §4.1 rather than
thrown.

## 6. Wiring

`SecurityGuard` gains an optional structural collaborator, matching how
`browserPairing` / `browserPolicy` are already declared as narrow interfaces in
`packages/mcp-tools/src/service-types.ts` rather than concrete imports:

```ts
interface ManifestPatternSource {
  patternsFor(workspaceId: string): Array<{ pattern: RegExp; class: Sensitivity }>;
}
```

`authorizeResource` passes `this.manifests?.patternsFor(lease.workspaceId) ?? []`
as `classifySensitivity`'s `userPatterns`, with `secret`-bucket patterns first
and the §4.2 self-protection pattern last (see §3 for why order matters — the
first match wins, so the strictest applicable bucket must be tried first). No
other line of that method changes.

In `apps/core/src/runtime.ts`, a small adapter resolves `workspaceId` to its
`hostRoot` via the existing `workspaces.getLocal()` and calls
`manifestService.read(hostRoot).protectedPatterns` — `SecurityGuard` itself never
reads a workspace record or the filesystem.

`commands` surfaces through the existing `workspace_current` and
`workspace_select` tool responses (`packages/mcp-tools/src/basic-tools.ts` for
the former, `packages/mcp-tools/src/authorization.ts` and
`packages/mcp-tools/src/approval-resume.ts` for the latter) rather than a new
tool: both gain a `manifest: { commands, protectedPathsSummary, warning }`
field. `protectedPathsSummary` is a count (`{ sensitive: number, secret: number
}`), not the raw compiled patterns — there is no reason to hand a client the
exact regex shape of what it cannot reach anyway.

`aevra.json`'s content is workspace file content like any other — the repo
already tags file reads `untrusted: true` (`packages/security/src/untrusted.ts`)
and treats them as data, not instructions. `commands` is no different: it is a
string an operator or a cloned repo supplied, surfaced to the client as a
suggestion, never executed by this feature itself. The `manifest` field on
both tool responses is wrapped in the existing `markUntrusted()` helper before
it is returned, and a client acting on a `commands` entry still goes through
the normal `shell_run` path with its normal risk tiering and approval —
exactly as if the agent had typed the command itself. This feature adds a
suggestion surface, not a new execution or trust path.

Every workspace record either tool can return carries this field: the single
`workspace` object from `workspace_select` and from single-lease
`workspace_current`, and each entry of the `workspaces` array in
`workspace_current`'s multi-lease `status: 'multiple'` response — each keyed to
its own workspace's `hostRoot`, not just the first one.

## 7. Testing

- `packages/security/test/glob.unit.test.ts` — `*`, `**` (including the `**/`
  prefix and `/**` suffix forms from §5), escaping, anchoring, malformed input,
  leading-slash tolerance, backslash separators, case-insensitivity.
- `apps/core/test/manifest-service.unit.test.ts` — absent file → defaults plus
  the §4.2 self-protection pattern; valid file → parsed, secret-before-sensitive
  ordering; malformed JSON → `warning` set, patterns fall back to just
  self-protection; one bad glob among good ones → that pattern dropped, named
  in `warning`, others survive; oversized file → same warning-shaped result as
  the other failure modes (not a thrown error — see §4.1); a second `read()`
  call with an unchanged file returns the cached result; a `read()` after the
  file's `mtimeMs` changes re-parses.
- Extends `apps/core/test/security-guard.unit.test.ts`'s suite (or a sibling
  file) — a `secret` pattern denies read and write; a `sensitive` pattern is
  approval-required on write, allowed on read; a path matching both a
  `sensitive` and a `secret` pattern resolves to `SECRET` regardless of
  declaration order; confirms `userPatterns` actually reaches
  `authorizeResource` now, not just the pure function.
- Extends the existing workspace integration tests — `workspace_current` /
  `workspace_select` responses carry `manifest.commands` when `aevra.json` is
  present, empty defaults when absent, `manifest.warning` when malformed, and
  `manifest` is `untrusted: true`.

The 85% coverage floor and `npm run test:gate` apply unchanged. New files stay
under the 350-line `.ts` cap — `ManifestService` mirrors `SkillsService`'s
smaller half (`instructions()` plus a size-capped read), not its full surface.

## 8. File layout

```
packages/security/src/glob.ts                 compileGlob
packages/security/test/glob.unit.test.ts
apps/core/src/workspaces/manifest-service.ts  ManifestService
apps/core/test/manifest-service.unit.test.ts
apps/core/src/security/security-guard.ts      + ManifestPatternSource collaborator
apps/core/src/runtime.ts                      + manifest service construction, adapter wiring
packages/mcp-tools/src/service-helpers.ts     + manifest param on workspaceResult
packages/mcp-tools/src/authorization.ts       + manifest passed at workspace_select call sites
packages/mcp-tools/src/approval-resume.ts     + manifest passed at workspace_select resume call sites
packages/mcp-tools/src/basic-tools.ts         + manifest field on workspace_current
```

(Corrected from the original draft, which placed both `workspace_select` call
sites in `basic-tools.ts` — they are actually in `authorization.ts` and
`approval-resume.ts`; confirmed by reading the source. `basic-tools.ts` is
where `workspace_current` alone lives.)

## 9. Build order

1. `compileGlob` with its unit suite — correct before anything depends on it.
2. `ManifestService` with its unit suite, including caching, self-protection,
   bucket ordering, and the malformed-file/bad-glob paths. No wiring yet.
3. `SecurityGuard` collaborator + `runtime.ts` adapter wiring. This is where the
   vulnerability the roadmap flagged (`userPatterns` dead) actually closes.
4. `workspace_current` / `workspace_select` response field for `commands`,
   wrapped in `markUntrusted()`.
5. Full gate.

Steps 1-2 are independently landable; 3 and 4 both depend on them but not on
each other.

## 10. Production call sites of `classifySensitivity`

Four, not one:

- `apps/core/src/security/security-guard.ts` — `authorizeResource`, the primary
  enforcement path and the only one this design wires manifest patterns into.
- `packages/mcp-tools/src/file-tools.ts` — `resourceSecurity()`'s fallback
  branch, used only when `context.deps.security` is absent. In the shipped
  runtime `deps.security` is always constructed (`apps/core/src/runtime.ts`),
  so this branch does not run in production today; it exists for tests and
  partial contexts. It is **not** wired to manifest patterns by this design —
  a context missing `deps.security` gets the hardcoded classification only.
  Documented here so this gap is a known, deliberate scope boundary rather than
  an oversight discovered later.
- `packages/mcp-tools/src/file-tools.ts` — `readTool()`'s post-read masking,
  which combines the result of the call above with the value already computed
  by whichever `resourceSecurity()` branch ran; it does not call
  `classifySensitivity` with fresh `userPatterns` of its own, so it is
  unaffected either way.
- `apps/core/src/skills/skills-service.ts` — `instructions()`, classifying
  `AGENTS.md`/`CLAUDE.md` content, unrelated to this feature and untouched.

## 11. Known limitations

Accepted for this iteration, not fixed by this design:

- **`protectedPaths` gates `file_*` tools only.** `shell_run cat
vendor/keys/id_rsa` does not go through `classifySensitivity` at all — zero
  call sites exist in the worker/executor path. This is a pre-existing
  property shared with the hardcoded `.env`/`id_rsa` detection, not something
  this feature introduces, but it means "never let the agent touch this" (§1)
  is scoped to the file tools, not to shell access.
- **Deleting an unlisted ancestor directory bypasses a nested pattern.** A
  pattern on `vendor/keys/**` now also matches `vendor/keys` itself (§5), so
  deleting that exact directory is gated. Deleting `vendor` (its parent, if
  `vendor` itself was never declared) is not — the pattern's static prefix is
  never generalized to ancestor directories. A cheap follow-up would compute
  each glob's literal (non-wildcard) prefix directory and add an implicit
  `SENSITIVE` pattern for it, but that risks false positives on unrelated
  siblings under the same prefix and is deferred as a separate, smaller design
  question rather than folded into this one.
- **`commands` are advisory text, not a trusted command source.** See §6 —
  this is by design, not an oversight, but worth restating: a workspace's
  `aevra.json` can declare any string under `commands`, and nothing about this
  feature grants that string elevated trust or bypasses `shell_run`'s normal
  risk tiering when a client chooses to run it.

## 12. Revision note (2026-09-14)

This spec was revised after implementation review surfaced defects in the
original draft: glob patterns that never matched `logicalPath`'s actual
leading-slash/backslash form (a silent no-op, not merely a bug — see §5);
`dir/**` not matching `dir` itself (§5); bucket iteration order allowing a
`SECRET` match to be shadowed by a `SENSITIVE` one (§3, §6); no protection
against an agent clearing its own `protectedPaths` by overwriting `aevra.json`
(§4.2); `commands` reaching a client without being marked untrusted (§6); and
two factual errors in the original draft (§8's file-layout claim, §10's "one
production call site" claim). All are incorporated above rather than tracked
as a separate errata list, since the original draft was never implemented
against.
