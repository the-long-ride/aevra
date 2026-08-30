# Aevra Roadmap & Weak-Points Map

**Date:** 2026-08-30 · **Baseline:** Aevra `1.0.4` · **Derived from:** Fast Lane batch tools, system capability detection, local transport protocol options and validation, Web UI polish, and full test suite verification.

This file tracks remaining product/architecture gaps only. Delivered work belongs in `CHANGELOG.md`.

## Current weak points

1. **Native MCP Tasks are not implemented.** Long work uses Aevra's durable managed-process pattern (`process_start/wait/status/logs`) rather than negotiated experimental MCP task support.
2. **The public tool vocabulary is static.** Aevra does not emit `tools/list_changed`; add it only if tools become dynamically visible per client/workspace.
3. **Remote transport is Streamable HTTP only.** Alternate transport variants should be added only for concrete client interoperability needs.
4. **Workspace roots are local host paths.** SSH/network/remote-root execution is intentionally unspecified until containment, credential, latency, and recovery semantics are designed.
5. **The daemon is deliberately single-user.** Admin credentials protect one local owner's control plane; a true multi-user/tenant authority model is not yet designed.
6. **Keep-awake support is platform dependent.** Unsupported or unavailable platform inhibitors degrade safely to an explicit unavailable state; broader platform coverage is future work.

## Recently closed in 0.1.3

- Host system capabilities detection across 11 toolchain categories and shell families with platform-specific recommended shell resolution.
- Configurable local gateway transport protocol (`localProtocol: https|http`) with strict loopback HTTPS for internal Admin and MCP listeners, interactive CLI setup, and runtime transport validation modal.
- Fast Lane batch tools (`file_read_many`, `file_write_many`, `command_run_many`) as primary model-facing interfaces while retaining singular primitives internally.
- Simplified 40-tool discoverable MCP surface.
- React Admin Web UI polish (System Capabilities panel, Transport Validation modal, accessible keyboard-navigable Dropdown, refactored activity stream hook).

## Not yet specified

- Multi-actor / multi-user authority and storage isolation.
- Dynamic MCP tool-list change notifications.
- Remote workspace mounts and their containment/recovery model.
- Additional MCP transport variants when required by supported clients.

## Out of scope

- Browser extension or DOM automation.
- Bypassing AI-client product limits.
- Running as SYSTEM/root or automatic privilege elevation.
