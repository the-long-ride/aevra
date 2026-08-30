# Aevra Documentation

Welcome. Everything here is written in **2-minute files** — pick a path and go.

| Path                                    | Audience              | Question it answers                                            |
| --------------------------------------- | --------------------- | -------------------------------------------------------------- |
| [`specs/`](specs/README.md)             | Engineers & AI agents | How does Aevra work inside, and why?                           |
| [`user-manual/`](user-manual/README.md) | End users             | How do I connect Claude.ai / ChatGPT / Gemini to my machine?   |
| [`ROADMAP.md`](ROADMAP.md)              | Everyone              | What's weak right now, and what gets built next (prioritized)? |
| [`RELEASING.md`](RELEASING.md)          | Maintainers           | How do I cut a release?                                        |

## Reading paths

**I maintain or extend Aevra (or I'm an agent working on this repo):**
`specs/01-system-overview` → `02-security-model` → `03-mcp-protocol` → `04-connectors` → `05-skills-instructions` → `06-workspaces-execution` → `07-state-migration` → `08-audit-recovery` → `09-configuration`

**I just want my AI client working:**
`user-manual/01-install` → `02-start` → `03-create-connector` → `04-connect-claude` (or `05`/`06`) → `07-register-workspace`

**Verified against:** Aevra `1.0.4` — bump this stamp on every release (see [`RELEASING.md`](RELEASING.md)).

## Rules of this documentation

- One file, one topic, ≤ 2 minutes to read.
- Specs describe _what and why_; the manual describes _how_.
- Every spec ends with **Boundaries** (what it does not cover) and **Related** links.
- Filenames are stable and numbered — cite them directly (`docs/specs/02-security-model.md`).
- Facts are verified against Aevra `1.0.4`.
