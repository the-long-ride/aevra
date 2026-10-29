# Aevra Documentation

Welcome. Everything here is written in **2-minute files** — pick a path and go.

| Path                                                                           | Audience              | Question it answers                                            |
| ------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------- |
| [`specs/`](specs/README.md)                                                    | Engineers & AI agents | How does Aevra work inside, and why?                           |
| [`user-manual/`](user-manual/README.md)                                        | End users             | How do I connect Claude.ai / ChatGPT / Gemini to my machine?   |
| [`ROADMAP.md`](ROADMAP.md)                                                     | Everyone              | What's weak right now, and what gets built next (prioritized)? |
| [`specs/10-package-and-test-runners.md`](specs/10-package-and-test-runners.md) | Maintainers           | How are package checks and release CI enforced?                |

## Architecture and implementation status

- [Custom startup ports](specs/12-custom-startup-ports.md) are implemented in `1.3.1`; see [first start](user-manual/02-first-start.md) and [service operation](user-manual/12-service.md) for commands.

- [Full desktop platform parity](designs/2026-10-15-desktop-full-parity-design.md) is partially implemented in the current source.
- [GNOME Wayland integration](designs/2026-10-15-wayland-gnome-design.md) implements compositor-bound capture/input; see [setup and verification limits](user-manual/22-wayland-desktop.md). [KDE KWin 6.6 integration](designs/2026-10-15-wayland-kde-design.md) provides a native plugin; software-rendered native acceptance passes, while GPU capture acceptance remains pending.

## Reading paths

**I maintain or extend Aevra (or I'm an agent working on this repo):**
`specs/01-system-overview` → `02-security-model` → `03-mcp-protocol` → `04-connectors` → `05-skills-instructions` → `06-workspaces-execution` → `07-state-migration` → `08-audit-recovery` → `09-configuration` → `10-package-and-test-runners` → `11-token-efficiency-and-usage`

**I just want my AI client working:**
`user-manual/01-install` → `02-start` → `03-create-connector` → `04-connect-claude` (or `05`/`06`) → `07-register-workspace`

**Verified against:** Aevra `1.3.2` — bump this stamp on every release.

## Rules of this documentation

- One file, one topic, ≤ 2 minutes to read.
- Specs describe _what and why_; the manual describes _how_.
- Every spec ends with **Boundaries** (what it does not cover) and **Related** links.
- Filenames are stable and numbered — cite them directly (`docs/specs/02-security-model.md`).
- Facts are verified against Aevra `1.3.2`.
