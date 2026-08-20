# Aevra Security Hardening — Central Guard Design

## Goal

Resolve the confirmed security findings while preserving compatibility unless a HIGH or CRITICAL issue requires behavior to change. Also inspect adjacent code paths for variants of the same control failures.

## Delivery model

Ship four sequential PRs. Each PR must be independently testable and mergeable. PR N+1 is rebased/reset onto the merged result of PR N before implementation begins.

1. `security/01-secret-data-isolation`
2. `security/02-authorization-isolation`
3. `security/03-oauth-abuse-hardening`
4. `security/04-security-regression-audit`

## Architecture choice

Use a central Core security guard plus Worker defense-in-depth.

Security evaluation order:

`authenticate -> identify connection -> workspace containment -> sensitivity classification -> immutable security invariants -> capability/YOLO policy -> local approval if required -> execute -> sanitize output`

Permissions, capability profiles, remembered rules, and YOLO never execute before immutable security checks.

## SecurityGuard

Add a Core-owned `SecurityGuard` boundary used by remote tool paths. It owns immutable checks for:

- caller identity `{actor, subject, sessionId}`;
- active workspace and logical resource identity;
- sensitivity `NORMAL | SENSITIVE | SECRET`;
- operation class;
- non-bypassable YOLO restrictions;
- one-time security approval requirements;
- sanitized execution environment construction;
- remote-safe metadata projection.

The guard returns an explicit allow / approval-required / deny decision. Callers cannot request that sensitivity, identity, or containment checks be skipped.

## YOLO contract

YOLO remains supported because it is useful for autonomous coding sessions.

YOLO means the remote AI may perform all normal workspace operations inside the selected registered workspace, subject to immutable security boundaries.

YOLO never bypasses:

- canonical workspace or mount containment;
- secret/sensitive resource policy;
- DLP/output sanitization;
- identity ownership checks;
- Worker envelope authentication and replay protection;
- execution environment isolation.

`disableYolo(sessionId)` must immediately restore the underlying lease/permission policy without disconnecting the MCP session, draining operations, or replacing the active lease.

## File sensitivity policy

### SECRET

Examples include `.env*`, private keys, certificate/private-key containers, and other paths classified SECRET.

Remote operations are denied for all of:

- read;
- search;
- create/overwrite;
- patch;
- move;
- delete.

This applies under normal capabilities, remembered allow rules, local persistent approvals, and YOLO.

Secret files must contribute zero search hits.

### SENSITIVE

Examples include `.npmrc`, credential-like JSON, gitignored configuration when classified sensitive, and configured sensitive mounts.

- read/search: return masked/sanitized data;
- mutation: always requires a fresh one-time local approval, including during YOLO;
- no persistent allow rule may remove this one-time requirement.

### NORMAL

Existing capability/permission/YOLO behavior remains unchanged.

## File I/O resource limits

Partial `file_read` must be implemented as a bounded Worker-side range read so requesting a small chunk never loads or transfers the entire file.

Preserve ordinary full-file behavior where practical. Add a high explicit maximum full read size so pathological files cannot exhaust Worker/Core memory; callers can use ranged reads for larger files.

Search must retain hit-count and per-file-size bounds and classify each file before reading it.

## Command and process environment isolation

Never copy the full Aevra daemon `process.env` into user commands or managed processes.

Build child environments from:

1. a minimal platform allowlist needed to locate/execute programs and temporary files;
2. explicitly supplied inline variables;
3. explicitly selected Aevra environment-profile variables/secrets.

Inline values are runtime-memory-only security data. They may be used for the active operation but must not be written into SQLite, approval records, process metadata, audit events, diagnostics, or live-activity entries.

Persistent metadata may contain variable names and secret references, never raw inline values.

## Process metadata

Remote MCP process results must not expose absolute host filesystem paths such as process log paths or result-sidecar paths. Local-admin APIs may retain local diagnostic paths.

`process_start` is host execution and must receive the same host-execution step-up semantics as `command_run`.

## Ownership model

Object identifiers are not authorization credentials.

Approval, change-set, and other privileged ID-addressed operations are authorized by connection ownership:

`actor + subject + workspaceId`

A fresh MCP session may resume existing state only when this tuple matches. A matching actor name alone is insufficient.

Local admin remains an explicitly privileged control plane.

## OAuth abuse protection

Protect dynamic OAuth registration/authorization with:

- per-IP registration rate limiting;
- pending authorization caps per IP;
- pending authorization caps per client;
- a bounded total dynamic-client quota;
- stale unused-client cleanup;
- cleanup exclusions for clients with active pending requests, grants, access tokens, or refresh tokens.

Use stable, minimally informative errors for abuse limits.

Default limits may be conservative and configurable; changing normal OAuth protocol shapes is a last resort.

## Compatibility rule

- LOW/MEDIUM finding: prefer mitigation that preserves existing MCP names and normal behavior.
- HIGH/CRITICAL finding: secure behavior wins when compatibility conflicts with the invariant.
- Existing tool names remain stable unless removal is required to close a HIGH/CRITICAL issue.

## Worker defense-in-depth

Worker independently preserves:

- authenticated HMAC operation envelopes;
- daemon-instance binding;
- expiry and replay-nonce rejection;
- canonical workspace/mount containment;
- bounded request/frame/output handling;
- minimal child environment construction.

Core denial is not considered sufficient protection for filesystem containment or environment isolation.

## Confirmed findings mapped to PRs

### PR1 — Secret & data isolation

- secret leakage through `file_search`;
- ambient daemon environment inherited by commands/processes;
- plaintext command/process env persistence;
- unbounded/whole-file partial reads;
- remote host-path disclosure;
- initial `SecurityGuard` resource/sensitivity boundary.

### PR2 — Authorization & session isolation

- `process_start` host step-up gap;
- approval status/cancel ownership;
- change-set status/commit/rollback ownership;
- adjacent process/ID ownership checks;
- reconnect tuple semantics;
- YOLO revoke-without-disconnect invariant.

### PR3 — OAuth abuse hardening

- public dynamic registration flooding;
- pending authorization flooding;
- client database growth;
- stale-client lifecycle bounds.

### PR4 — Security regression & adjacent audit

Re-audit filesystem, symlink/junction behavior, IPC, process lifecycle, OAuth/token lifecycle, approval resume, recovery, admin APIs, config export, secret stores, DLP, and other privileged paths for control bypass variants.

## Verification policy

Every behavioral fix is exploit-test-first:

1. add a regression test that demonstrates the unsafe behavior;
2. verify it fails for the intended reason;
3. implement the smallest structural fix;
4. verify focused tests;
5. run full format/lint/typecheck/test/security/coverage/build gates before merge.

PR4 may add property tests and threat-model documentation even when no additional vulnerability is found.

## Rollback

Each PR stays independently revertible. Database changes should be additive. Do not use a compatibility flag that restores unsafe behavior. If a compatibility regression is discovered, restore the safe API shape where possible instead of restoring the vulnerable control path.
