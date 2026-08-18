# Exact Capability Permissions Design

## Status
Approved in chat on 2026-08-18; written for final review before implementation.

## Problem
Aevra currently has two authorization layers that can disagree:

1. A workspace lease exposes a fixed capability profile such as `read-only`, `coding-session`, `developer`, or `full-workspace`.
2. Permission rules independently remember allow/deny decisions by capability, scope, actor, session, workspace, and matcher.

This creates a correctness bug. The Web UI can create an allow rule for `files.write`, but an MCP client can still see `files.write` as unavailable because `aevra_status` reports only lease capabilities and tool execution can reject a missing lease capability before consulting the matching permission rule. OAuth clients also currently request broad profile upgrades instead of the exact capability they need, while static Bearer connector actors do not share the same upgrade flow.

The result is confusing and over-broad: the admin UI can show an allow rule that does not become effective access, and approving one capability can unintentionally grant several unrelated capabilities.

## Goals

- Make remembered permission rules effective authorization, not merely records in the admin table.
- Make ChatGPT, Claude, Gemini, static Bearer connectors, and OAuth connectors use the same exact-capability request model.
- Never broaden an approval into unrelated capabilities.
- Keep command authorization matcher-specific.
- Let the Permissions modal target configured connectors even when they are offline.
- Support multiple command matchers in one bulk permission action.
- Add conservative platform-specific safe matcher guidance for Windows, Linux, and macOS.
- Remove duplicate permission toasts and keep one bottom-right notification stack.

## Non-goals

- Do not replace capability profiles. Profiles remain useful baseline bundles for initial workspace admission.
- Do not encode individual Aevra capabilities into OAuth scopes.
- Do not make shell families such as `shell:powershell` or `shell:bash` safe by default.
- Do not allow persistent authorization for CRITICAL operations.
- Do not create a second permission-rule persistence format.

## Authorization model

### Baseline profiles
Workspace profiles remain the baseline capability source. A newly admitted client may receive a read-only or other configured profile exactly as today.

### Exact-capability overlay
Permission rules become an authorization overlay on top of the baseline profile. For any requested operation, Aevra determines access from:

1. an explicit matching deny rule;
2. a baseline lease capability;
3. an explicit matching allow rule;
4. otherwise, a local approval request.

A deny remains stronger than an allow. CRITICAL operations still require one-time local authorization even if an allow rule exists.

The overlay is evaluated against the operation's exact matcher. A rule for `commands.run` + `git:status` does not authorize `npm:install`, `shell:powershell`, or arbitrary command execution.

### Effective capability reporting
`aevra_status` must no longer imply that the raw lease profile is the complete permission state. It returns both:

- `baselineCapabilities`: capabilities coming from the active lease/profile;
- `effectiveCapabilities`: capabilities that are usable because of the baseline profile or currently applicable permission rules;
- `commandMatchers`: remembered `commands.run` allow matchers applicable to this actor/session/workspace;
- existing workspace/session/execution information.

For compatibility, the existing `capabilities` field aliases `effectiveCapabilities`.

A capability is included in `effectiveCapabilities` only when the permission overlay can safely summarize it as usable. For non-command capabilities, an applicable allow rule with matcher `*` is sufficient. For `commands.run`, the capability may be listed when at least one matcher is allowed, while `commandMatchers` communicates the restriction. A deny must not be hidden by this summary.

## Exact-capability approval flow

When a connector attempts an operation requiring a capability not provided by its baseline lease and not already allowed by policy, Aevra creates an approval request for exactly that capability and operation.

Examples:

- `ChatGPT requests files.read for workspace Aevra`
- `Claude requests files.write for workspace Aevra`
- `Gemini requests files.delete for workspace Aevra`
- `ChatGPT requests commands.run: git:status for workspace Aevra`

Available decisions remain:

- Deny
- Allow once
- Allow for session
- Allow for workspace
- Allow globally, when the existing approval policy permits it

Persistent choices create ordinary permission-rule records. They do not mutate the client's workspace profile.

The same flow applies to actors beginning with `connector:` and `oauth:`. Static Bearer connectors must not fail early merely because they are not OAuth actors.

### File operations
`file_list`, `file_read`, `file_search`, `file_write`, `file_create`, `file_move`, `file_patch`, and `file_delete` all participate in exact-capability authorization.

The operation service must not independently reject an operation solely because the baseline lease lacks a capability that the permission layer already authorized. Authorization must be established once at the MCP service boundary and carried into execution through an explicit trusted authorization context rather than by mutating the workspace profile.

### Git, command, network, process, and recovery operations
Existing operation-family risk classification and matcher checks remain in place. Missing capabilities use the same exact-capability approval path instead of profile upgrades.

`commands.run` remains matcher-specific and risk-aware. CRITICAL command operations are always locally confirmed.

## Bulk Permissions UI

### Connector targeting
The modal label becomes `Selected connectors`, not `Selected connected connectors`.

The selectable connector list includes all configured static Bearer connectors from `/api/connectors`, whether active or inactive. OAuth connector identities that Aevra has registered or can resolve as configured clients are also included. Activity is status metadata, not an eligibility requirement.

Rows show a short status such as:

- Connected
- Configured
- Never used

Session scope remains the exception: selecting a session target requires an actual live MCP session.

### Matcher expansion
Non-command capabilities use matcher `*` by default.

When `commands.run` is selected, Rule details displays a multiline `Command matchers` editor. One matcher is accepted per line. Input is trimmed, blank lines are removed, and duplicate matchers are deduplicated.

Example input:

```text
git:status
git:diff
npm:test
dotnet:test
```

If the user selects `files.read`, `files.write`, and `commands.run`, Aevra creates rules such as:

```text
files.read    *
files.write   *
commands.run  git:status
commands.run  git:diff
commands.run  npm:test
commands.run  dotnet:test
```

Command matchers apply only to `commands.run`. They are never copied to file, Git, or network capability rules.

The footer rule count reflects the full connector × scope-target × capability/matcher expansion. `commands.run` requires at least one matcher when selected. An explicitly entered `*` remains possible but shows a broad-access warning.

The bulk API accepts a matcher list for `commands.run` while continuing to produce normal individual permission-rule rows. Backward compatibility for the existing single `matcher` request is retained where practical.

## Safe command matcher Guide

Guide receives a new chapter/tab named `Safe command matchers` with platform tabs:

- Windows
- Linux
- macOS

The guide is driven by a shared conservative matcher catalog used by both UI rendering and tests. It does not infer safety merely because current risk classification returns LOW; unknown command families must not be advertised as safe.

Each entry includes:

- matcher;
- example command;
- purpose;
- platform applicability;
- risk note;
- copy action.

Initial recommended families include known inspection/test/build operations such as:

- `git:status`, `git:diff`, `git:log`, `git:show`, `git:branch`;
- package-manager test/lint families such as `npm:test`, `npm:lint`, and equivalent supported pnpm/yarn families;
- `cargo:test`, `cargo:check`, `cargo:build`;
- `dotnet:test`, `dotnet:build`, `dotnet:restore`;
- conservative read-only platform commands where Aevra's command classifier has an explicit known family.

Broad shell families including `shell:powershell`, `shell:bash`, and `shell:sh` are excluded from the recommended-safe catalog because they can execute arbitrary script text.

The guide must state that the list is recommended, not a security guarantee, and that command arguments and execution mode can raise risk.

## Toast behavior

Aevra keeps one notification implementation: the global runtime toast stack.

- Remove the duplicate enhancement-specific toast host.
- Place the global stack at the bottom-right.
- Newest notification appears nearest the bottom edge; older notifications stack upward.
- Permission deletion uses contextual copy: `Permission removed from {connector}`.
- The permission page supplies the actor/connector context to the global mutation-toast path rather than firing a second toast itself.
- Other mutation toasts continue through the same global system.

## Data and API changes

### Permission repository/query support
Add focused query helpers for applicable rules so effective permissions can be computed without duplicating SQL/policy logic in the Web UI or MCP service.

The PermissionEngine remains the source of truth for exact operation decisions. A separate summary helper may expose applicable wildcard capabilities and command matchers for `aevra_status`.

### Bulk endpoint
`POST /api/permissions/bulk` supports command matcher arrays and validates each matcher independently. Critical persistent matcher protections continue to apply to every generated allow rule.

### Connector inventory
The Web API must provide enough configured connector identity information for the modal to list offline static connectors and configured OAuth clients. The UI should not manufacture actor names that the backend cannot later match.

## Error handling and security

- Invalid/empty matcher lists return a 400 validation error before any rules are written.
- Bulk generation is all-or-nothing: validate the entire expansion before persisting records.
- Duplicate generated rules may be deduplicated deterministically rather than creating visually duplicated rows.
- Persistent CRITICAL allow rules remain rejected.
- Exact-capability approval resume revalidates actor, connection identity, workspace, session where applicable, and operation state before executing frozen work.
- Deny rules continue to override allow rules.
- A disconnected connector may receive workspace/global remembered rules, but session-scoped rules require a current session.

## Testing

### Policy and MCP tests
Add regression tests proving:

- a `files.write` allow rule becomes effective even when the baseline lease is read-only;
- `aevra_status.capabilities` reports the effective capability and exposes the baseline separately;
- an exact `files.write` approval grants no unrelated capability;
- static `connector:` and `oauth:` actors use the same missing-capability approval path;
- read, write, delete, command, Git, network, process, and recovery operations cannot bypass the exact overlay;
- command allow `git:status` does not authorize another family;
- deny wins over allow;
- CRITICAL remains one-time approval.

### Bulk API tests
Cover matcher-array expansion, deduplication, validation, atomic failure, and critical-pattern rejection.

### Web tests
Cover offline connector listing, session-only live-session targeting, command matcher editor behavior, calculated rule counts, broad `*` warning, and absence of duplicate toast implementations.

### Guide tests
Assert the Windows/Linux/macOS tabs render from the catalog and that prohibited broad shell families are not in the recommended-safe list.

## Compatibility and migration

Existing permission-rule rows remain valid; no database migration is required for the rule schema. Existing profile mappings remain baseline admission configuration. The behavioral change is that applicable allow rules now participate in capability authorization instead of being blocked by an earlier lease-only capability check.

Existing clients consuming `aevra_status.capabilities` receive a more accurate effective list. New fields expose the distinction between baseline and effective permission state.
