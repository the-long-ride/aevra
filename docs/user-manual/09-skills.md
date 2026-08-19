# Skills

Aevra can expose user and workspace skill material to compatible AI clients. Skills do not expand filesystem or command permissions by themselves.

Read access uses `skills.read` and `instructions.read`. Write access is separate: `skills.write` and `instructions.write`. Ordinary `files.write` does not grant either write capability.

The MCP tools are:

- `skills_list`
- `skill_read`
- `skill_write`
- `instructions_read`
- `instructions_write`

`skill_write` can only update a bounded UTF-8 file inside an existing skill package. `instructions_write` can only update `~/.agents/AGENTS.md` or the active workspace `AGENTS.md`. Neither tool accepts an arbitrary filesystem root.

Use skill content as guidance for the client, then rely on normal Aevra capabilities, workspace boundaries, approvals, and auditing for execution.
