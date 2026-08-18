# Controlled Shell Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `shell_run` MCP tool that supports PowerShell/bash scripts without bypassing Aevra's existing command security pipeline.

**Architecture:** `shell_run` converts a script into an argv-based `CommandInput` at the MCP boundary and delegates to the existing `command_run`/`command.run` path. Sandbox remains the default; raw shell invocations are conservatively HIGH risk and therefore require local approval unless an applicable remembered rule allows them. The tool never enables Node `shell:true`.

**Tech Stack:** TypeScript, Node.js MCP service, existing Aevra approval/permission/worker/sandbox pipeline.

**Spec:** Approved in conversation on 2026-08-18.

## Global Constraints

- Keep `main` untouched; implement on `fix/chatgpt-mcp-xai-ui`.
- Default execution mode is `sandbox`.
- `auto` shell uses `bash` in the current Linux container sandbox; on host it resolves to `powershell.exe` on Windows and `bash` otherwise.
- PowerShell in strict sandbox is rejected because the current `node:22-bookworm-slim` sandbox image does not include PowerShell.
- `shell_run` requires `commands.run` and never bypasses workspace selection, approval, network policy, DLP, timeout, audit, or worker execution.
- Raw shell execution is HIGH risk by default; privilege-escalation patterns remain CRITICAL.
- Command output is bounded to 1 MiB per stream and environment-secret values are redacted before results return.

---

### Task 1: Shell command resolver

**Files:**
- Create: `packages/mcp-tools/src/shell-command.ts`
- Test: `packages/mcp-tools/test/shell-command.unit.test.ts`

**Interfaces:**
- Produces: `buildShellCommand(input, platform)` returning `CommandInput`.

- [x] Implement explicit `auto | powershell | bash | sh` resolution with argv only.
- [x] Validate non-empty scripts and positive bounded timeout values.
- [x] Reject PowerShell in the current strict sandbox.

### Task 2: MCP tool and policy integration

**Files:**
- Modify: `packages/mcp-tools/src/registry.ts`
- Modify: `packages/mcp-tools/src/register.ts`
- Modify: `apps/core/src/policy/command-family.ts`
- Test: `packages/mcp-tools/test/registry.unit.test.ts`
- Test: `packages/mcp-tools/test/register.structured-content.contract.test.ts`
- Test: `packages/mcp-tools/test/shell-run.integration.test.ts`
- Test: `apps/core/test/command-family.unit.test.ts`

**Interfaces:**
- Consumes: `buildShellCommand`.
- Produces: `shell_run` MCP tool with `script`, `shell`, `executionMode`, `timeoutMs`, `env`, and `networkDestinations` inputs.

- [x] Add `shell_run` to the stable tool vocabulary and concrete schema.
- [x] Mark it non-read-only and open-world like `command_run`.
- [x] Translate it into argv-based `command_run` before execution.
- [x] Classify raw shell commands as HIGH risk and privilege patterns as CRITICAL.
- [x] Verify local approval occurs before execution and frozen approval resume uses the same command path.

### Task 3: Executor safety parity

**Files:**
- Modify: `packages/executor/src/commands.ts`
- Modify: `packages/executor/src/docker.ts`
- Test: `packages/executor/test/commands.contract.test.ts`
- Test: `packages/executor/test/docker.integration.test.ts`

- [x] Enforce `timeoutMs` for host and Docker/Podman command execution.
- [x] Bound stdout and stderr to 1 MiB per stream with an explicit truncation marker.
- [x] Apply DLP redaction to sandbox output as well as host output.
- [x] Stop placing environment secret values directly in Docker/Podman command-line arguments.

### Task 4: Verification

- [ ] Confirm branch diff is limited to the controlled shell feature, tests, executor safety parity, and plan documentation.
- [ ] Inspect automatic GitHub checks if present; do not manually trigger or rerun CI.
