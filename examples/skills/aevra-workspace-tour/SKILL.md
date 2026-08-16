---
name: aevra-workspace-tour
description: Introduce a newly registered Aevra workspace to the AI — what it contains, its instructions, and its skills
---

# Aevra workspace tour

When the user asks you to "tour" or "get familiar with" the current workspace:

1. Call `aevra_status` to confirm the session and active capabilities.
2. Call `file_list` on `/` and skim the top-level layout.
3. Call `instructions_read` — follow any workspace AGENTS.md rules from now on.
4. Call `skills_list` with `{source: 'workspace'}` implicitly via `query` if supported, and read any skill whose description matches the project domain.
5. Summarize back: project type, entry points, rules you will follow, and skills you can use.

Never modify files during a tour.
