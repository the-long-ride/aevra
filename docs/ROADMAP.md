# Aevra Roadmap & Weak-Points Map

**Date:** 2026-08-26 · **Baseline:** Aevra `0.1.2` · **Derived from:** the MCP 2.0 migration, OAuth continuity work, exposure/security review, keep-awake implementation, Web UI consolidation, and the current full repository gate.

This file tracks remaining product/architecture gaps only. Delivered work belongs in `CHANGELOG.md`.

## Current weak points

1. **Native MCP Tasks are not implemented.** Long work uses Aevra's durable managed-process pattern (`process_start/wait/status/logs`) rather than negotiated experimental MCP task support.
2. **The public tool vocabulary is static.** Aevra does not emit `tools/list_changed`; add it only if tools become dynamically visible per client/workspace.
3. **Remote transport is Streamable HTTP only.** Alternate transport variants should be added only for concrete client interoperability needs.
4. **Workspace roots are local host paths.** SSH/network/remote-root execution is intentionally unspecified until containment, credential, latency, and recovery semantics are designed.
5. **The daemon is deliberately single-user.** Admin credentials protect one local owner's control plane; a true multi-user/tenant authority model is not yet designed.
6. **Keep-awake support is platform dependent.** Unsupported or unavailable platform inhibitors degrade safely to an explicit unavailable state; broader platform coverage is future work.

## Recently closed in 0.1.2

- Durable OAuth connection identity, refresh-family rotation/replay revocation, reconnect grace, remembered multi-workspace grants, and connection-level YOLO.
- Connection-owned durable operation inspection so lost responses do not require unsafe mutation replay.
- Independent MCP/OAuth and Admin public URLs with exact HTTPS Admin-origin trust and no forwarded-header trust expansion.
- Managed ngrok stable-domain mode with origin verification.
- Cross-platform keep-awake policies that inhibit idle sleep without forcing the display on or disabling screen lock.
- Compact Settings workflows and Runtime Overview status density.
- Engineering specs synchronized through schema migration v10 and the 42-tool MCP surface.

## Not yet specified

- Multi-actor / multi-user authority and storage isolation.
- Dynamic MCP tool-list change notifications.
- Remote workspace mounts and their containment/recovery model.
- Additional MCP transport variants when required by supported clients.

## Out of scope

- Browser extension or DOM automation.
- Bypassing AI-client product limits.
- Running as SYSTEM/root or automatic privilege elevation.
