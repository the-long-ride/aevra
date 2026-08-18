# Controlled Shell Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `shell_run` MCP tool that supports PowerShell/bash scripts without bypassing Aevra's existing command security pipeline.

**Architecture:** `shell_run` converts a script into an argv-based `CommandInput` and delegates to the existing `command.run` operation path. Sandbox remains the default; host execution is explicit and receives a higher approval-risk floor. The tool never enables Node `shell:true`.

**Tech Stack:** TypeScript, Node.js MCP service, existing Aevra approval/permission/worker/sandbox pipeline.

**Spec:** Approved in conversation on 2026-08-18.

## Global Constraints

- Keep `main` untouched; implement on `fix/chatgpt-mcp-xai-ui`.
- Default execution mode is `sandbox`.
- `auto` shell uses `bash` in the current Linux container sandbox; on host it resolves to `powershell.exe` on Windows and `bash` otherwise.
- PowerShell in strict sandbox is rejected because the current `node:22-bookworm-slim` sandbox image does not include PowerShell.
- `shell_run` requires `commands.run` and never bypasses workspace selection, approval, network, DLP, timeout, audit, or worker execution.
- Raw shell execution has minimum risk `MEDIUM` in sandbox and `HIGH` on host.

---

### Task 1: Shell command resolver

**Files:**
- Create: `packages/mcp-tools/src/shell-command.ts`
- Test: `packages/mcp-tools/test/shell-command.unit.test.ts`

**Interfaces:**
- Produces: `buildShellCommand(input, platform)` returning `CommandInput`.
- Produces: `shellRiskFloor(mode)` returning `MEDIUM | HIGH`.

- [ ] Implement explicit `auto | powershell | bash | sh` resolution with argv only.
- [ ] Validate non-empty scripts and positive bounded timeout values.
- [ ] Reject PowerShell in the current strict sandbox.

### Task 2: MCP tool and policy integration

**Files:**
- Modify: `packages/mcp-tools/src/registry.ts`
- Modify: `packages/mcp-tools/src/service.ts`
- Modify: `packages/mcp-tools/test/registry.unit.test.ts`

**Interfaces:**
- Consumes: `buildShellCommand`, `shellRiskFloor`.
- Produces: `shell_run` MCP tool with `script`, `shell`, `executionMode`, `timeoutMs`, `env`, and `networkDestinations` inputs.

- [ ] Add `shell_run` to the stable tool vocabulary and concrete schema.
- [ ] Mark it non-read-only and open-world like `command_run`.
- [ ] Route through the existing command approval path with the stronger shell risk floor.
- [ ] Preserve `shell_run` in frozen approval payloads so resume executes the same command.

### Task 3: Verification

**Files:**
- Verify: `packages/mcp-tools/test/shell-command.unit.test.ts`
- Verify: `packages/mcp-tools/test/registry.unit.test.ts`

- [ ] Confirm branch diff only adds the controlled shell surface and tests/docs.
- [ ] Inspect automatic GitHub checks if present; do not manually trigger or rerun CI.
