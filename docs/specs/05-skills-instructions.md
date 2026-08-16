# 05 — Skills & Instructions

**Audience:** engineers & AI agents · **Scope:** how skills and AGENTS.md reach the remote AI · **Verified against:** `0.4.0`

Aevra gives a web AI the same context conventions local coding agents use: a **skills** library and **instruction files**, both served read-only over MCP.

## Sources

| Source | Skills | Instructions |
|---|---|---|
| `user` | `~/.agents/skills/<dir>/SKILL.md` | `~/.agents/AGENTS.md` |
| `workspace` (active lease only) | `<workspace-root>/.agents/skills/<dir>/SKILL.md` | `<workspace-root>/AGENTS.md`, falling back to `CLAUDE.md` |

User-source skills live **outside any workspace root** — `skill_read` is the only path to them, by design.

## Tools

- **`skills_list`** → `{skills:[{name, source:'user'|'workspace', description}]}`. Name/description come from SKILL.md YAML frontmatter (parsed from a 4 KB preview — the scan never loads whole files); no frontmatter ⇒ directory name, empty description. Name collisions are kept — both entries, disambiguated by `source`.
- **`skill_read {source, name, file?}`** → SKILL.md content plus the supporting-file list; with `file`, that one file's content. Guards: canonical resolve + `realpath` confined to the skill directory (`SKILL_PATH_ESCAPE`), 256 KB per-file cap (`SKILL_FILE_TOO_LARGE`), missing skill/file ⇒ `SKILL_NOT_FOUND`.
- **`instructions_read`** → `{instructions:[{source, content}]}` for each file found; empty ⇒ `{instructions:[], note}` — never an error.

## Security posture

- Read-only; admitted under **every** capability profile (even Read Only) with no approval gating; session validity is the only gate.
- Secret-classified files (e.g. `.env`) are masked before return — same DLP path as `file_read`.
- Frontmatter is a hand-rolled `key: value` subset — **no new runtime dependency**.

## Implementation pointer

`apps/core/src/skills/skills-service.ts` — `scanSkills()` walks a base once; `list()`/`read()`/`instructions()` build on it. Wired into `McpToolService.deps.skills`.

**Boundaries:** what skills *contain* is the user's domain; execution of skill steps is the AI client's job — Aevra only serves content.

**Related:** [`03-mcp-protocol`](03-mcp-protocol.md) · [`../user-manual/09-skills`](../user-manual/09-skills.md)

**Next →** [`06-workspaces-execution`](06-workspaces-execution.md)
