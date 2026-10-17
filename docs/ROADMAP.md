# Aevra Roadmap & Weak-Points Map

**Date:** 2026-10-15 · **Baseline:** Aevra `1.3.0` · **Derived from:** shipped browser control, Windows desktop control, the workspace manifest, and the security review of all three.

This file tracks remaining product/architecture gaps only. Delivered work belongs in `CHANGELOG.md`.

## Current weak points

1. **Native MCP Tasks are not implemented.** Long work uses Aevra's durable managed-process pattern (`process_start/wait/status/logs`) rather than negotiated experimental MCP task support.
2. **The public tool vocabulary is static.** Aevra does not emit `tools/list_changed`; add it only if tools become dynamically visible per client/workspace.
3. **Remote transport is Streamable HTTP only.** Alternate transport variants should be added only for concrete client interoperability needs.
4. **Workspace roots are local host paths.** SSH/network/remote-root execution is intentionally unspecified until containment, credential, latency, and recovery semantics are designed.
5. **The daemon is deliberately single-user.** Admin credentials protect one local owner's control plane; a true multi-user/tenant authority model is not yet designed.
6. **Keep-awake support is platform dependent.** Unsupported or unavailable platform inhibitors degrade safely to an explicit unavailable state; broader platform coverage is future work.
7. **Desktop control can reach what browser control refuses.** Input is approval-gated now, but an approved `desktop_type` into a browser's address bar still reaches a URL without passing `classifyOrigin` or the navigation DLP scan, and an approved click inside an editor still reaches its integrated terminal without passing command policy. The window gate works at process granularity, and a browser or an editor is exactly what a desktop agent needs to drive. Closing this needs cross-surface policy, not another denylist entry.
8. **The manifest's protected paths do not bind `shell_run`.** They are enforced on file tools and on search hits. A command that reads the same file is governed by command policy alone. Either wire the manifest into command authorization or say plainly in the manifest docs that it is a file-tool boundary.

## Current desktop validation

- Linux capture/input: **Ubuntu X11** with XTest/Composite and **GNOME Wayland / KDE KWin 6.6** with explicitly enabled compositor companions and approved helper paths. Real private GNOME 50/Ubuntu 26.04 fixture evidence covers capture/input and authorization; GNOME 46 native CI is configured. See [setup and validation](user-manual/22-wayland-desktop.md). AT-SPI semantic actions remain independently available when the provider can identify the target.
- macOS capture/input adapters are implemented; native Mac build/runtime acceptance is still required.

## Planned desktop work

- **Wayland acceptance and wider compositor support:** Physical-GPU/OpenGL capture acceptance and additional KWin versions remain follow-up work. Other compositors and a generic RemoteDesktop/ScreenCast/PipeWire/EIS adapter still need reliable source-to-app proof and native tests. GNOME currently uses its consented companion because opaque portal stream IDs do not establish app identity. See the [GNOME design](designs/2026-10-15-wayland-gnome-design.md).

## Not yet specified

- Multi-actor / multi-user authority and storage isolation.
- Dynamic MCP tool-list change notifications.
- Remote workspace mounts and their containment/recovery model.
- Additional MCP transport variants when required by supported clients.
- **MCP client `roots` protocol.** Naming hazard: `roots` already means `CapabilityRoot` across `mcp-tools`; the MCP concept needs a different identifier.
- **Advanced MCP gateway behavior beyond the shipped upstream proxy.** Basic HTTP/SSE/stdio upstream registration, namespaced catalog projection, review, and audited calls now ship in 1.0.5. Sampling proxying, richer downstream negotiation, and other gateway extensions remain unspecified.
- Progress notifications, request cancellation, and elicitation.
- An HTTP request tool, a workspace manifest schema beyond commands/protected paths, and non-text file extraction (pdf/docx/xlsx/image).
- File and workspace MCP resources, `subscribe`, and `listChanged`. Resources expose skills only today.
- Native helper artifacts are packaged by release CI. Authenticode signing remains future work; unsigned Windows downloads can trigger SmartScreen.
- Human-takeover abort for desktop control: grabbing the mouse mid-action currently stops nothing. Needs a low-level input hook.
- Multi-monitor screen capture. `DesktopCaptureResult` carries no origin, so only the primary monitor is coordinate-mappable.

## Out of scope

- Bypassing AI-client product limits.
- Running as SYSTEM/root or automatic privilege elevation.
