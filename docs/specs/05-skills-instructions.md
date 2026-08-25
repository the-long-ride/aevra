# 05 — Skills & Instructions

**Audience:** engineers & AI agents · **Scope:** how skills and AGENTS.md reach the remote AI · **Verified against:** `0.1.1`

Aevra gives a web AI the same context conventions local coding agents use: a **skills** library and **instruction files**. Reads and writes are purpose-specific MCP operations with capabilities separate from ordinary workspace file access.

## Sources

| Source                          | Skills                                           | Instructions                                               |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `user`                          | `~/.agents/skills/<dir>/SKILL.md`                | `~/.agents/AGENTS.md`                                      |
| `workspace` (active lease only) | `<workspace-root>/.agents/skills/<dir>/SKILL.md` | `<workspace-root>/AGENTS.md`, read fallback to `CLAUDE.md` |

User-source skills live **outside any workspace root** — skill tools are the only remote path to them, by design. Instruction writes always target `AGENTS.md`; Aevra never writes `CLAUDE.md` through `instructions_write`.

## Capabilities

The permission model contains four independent capabilities:

- `skills.read`
- `skills.write`
- `instructions.read`
- `instructions.write`

`files.read` does not grant skill/instruction reads, and `files.write` does not grant skill/instruction writes. Built-in Read Only, Coding Session, and Developer profiles include the two read capabilities. Full Workspace includes all four. YOLO derives from the complete capability set.

## Tools

- **`skills_list`** → `{skills:[{name, source:'user'|'workspace', description}]}`. Name/description come from SKILL.md YAML frontmatter (parsed from a 4 KB preview — the scan never loads whole files); no frontmatter ⇒ directory name, empty description. Name collisions are kept — both entries, disambiguated by `source`.
- **`skill_read {source, name, file?}`** → SKILL.md content plus the supporting-file list; with `file`, that one file's content. Guards: canonical resolve + `realpath` confined to the skill directory (`SKILL_PATH_ESCAPE`), 256 KB per-file cap (`SKILL_FILE_TOO_LARGE`), missing skill/file ⇒ `SKILL_NOT_FOUND`.
- **`skill_write {source, name, file?, content}`** → writes bounded UTF-8 content only inside an **existing** skill package. `file` defaults to `SKILL.md`; nested supporting files may be created. Absolute paths, `.`/`..`, symlink escapes, directory targets, and files over 256 KB are rejected.
- **`instructions_read`** → `{instructions:[{source, content}]}` for each file found; empty ⇒ `{instructions:[], note}` — never an error.
- **`instructions_write {source, content}`** → writes only `~/.agents/AGENTS.md` for `user` or `<workspace-root>/AGENTS.md` for `workspace`; there is no arbitrary path argument.

Write tools use normal Aevra capability, permission, approval, audit, and session/workspace checks. They are intentionally separate from `file_write` so an administrator can allow agent-context maintenance without granting general filesystem mutation.

## Security posture

- Skill/instruction reads require their dedicated read capability when a workspace lease exists.
- Before workspace selection, the compatibility skill-resource gate can grant one session-scoped read approval for user skill discovery; this does not grant write access.
- Secret-classified supporting files (e.g. `.env`) are masked before return — same DLP path as `file_read`.
- Writes resolve and contain their targets before creating directories or replacing files. Aevra rejects symlink/non-directory path components.
- Frontmatter is a hand-rolled `key: value` subset — **no new runtime dependency**.

## Implementation pointer

`apps/core/src/skills/skills-service.ts` owns scanning, bounded reads, and bounded writes. Capability and approval policy stays in the MCP/Core layers rather than being embedded in filesystem helpers.

**Boundaries:** execution of skill steps is the AI client's job; Aevra serves and safely maintains the context files but does not autonomously execute a skill definition.

**Related:** [`03-mcp-protocol`](03-mcp-protocol.md) · [`../user-manual/09-skills`](../user-manual/09-skills.md)

**Next →** [`06-workspaces-execution`](06-workspaces-execution.md)
