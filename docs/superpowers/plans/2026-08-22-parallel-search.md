# Native Parallel Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable `search` MCP tool that executes up to the user-configured number of native search queries concurrently inside Aevra's Execution Worker.

**Architecture:** The MCP service validates limits and authorization, then sends one `search.parallel` operation through the signed worker envelope. A focused executor module selects ripgrep when available and platform-native fallbacks otherwise, normalizes matches, and reapplies Aevra sensitivity rules before returning logical paths.

**Tech Stack:** TypeScript, Node.js child_process, ripgrep when installed, PowerShell fallback on Windows, grep/find fallback on Unix, React Settings UI.

**Spec:** `docs/superpowers/specs/2026-08-22-search-hooks-middleware-design.md`

## Global Constraints

- Tool name is exactly `search`.
- Existing `file_search` remains unchanged and compatible.
- Capability is `files.search`.
- Default parallel query limit is `8`; configurable range is `1..32`.
- Default per-query result limit is `100`.
- Native commands use executable/argument arrays, never interpolated shell strings.
- Paths remain constrained to workspace capability roots.

---

### Task 1: Search protocol and MCP schema

**Files:**
- Modify: `packages/protocol/src/worker.ts`
- Modify: `packages/mcp-tools/src/registry.ts`
- Modify: `packages/mcp-tools/src/registry-input-schemas.ts`
- Test: `packages/mcp-tools/test/registry.unit.test.ts` or nearest existing registry test

**Interfaces:**
- Produces: `SearchQueryInput` and worker operation `{ kind: 'search.parallel'; queries: SearchQueryInput[]; maxResultsPerQuery: number; maxOutputBytes: number }`.

- [ ] **Step 1: Add failing registry/protocol tests**

Assert `toolDefinitions()` contains exactly one `search` tool with `readOnlyHint` and `idempotentHint`, an input schema requiring `queries`, query modes `text|regex|files`, and workspace target fields.

- [ ] **Step 2: Run focused tests and confirm failure because `search` is absent**
- [ ] **Step 3: Add the stable tool name, schema, read-only annotation, description, and worker operation type**
- [ ] **Step 4: Run focused tests and confirm pass**

### Task 2: Native search executor

**Files:**
- Create: `packages/executor/src/search.ts`
- Test: `packages/executor/test/search.unit.test.ts`

**Interfaces:**
- Produces: `parallelSearch(queries, roots, options): Promise<SearchParallelResult>`.
- Internal adapters: `searchWithRipgrep`, `searchWithWindowsFallback`, `searchWithUnixFallback`.

- [ ] **Step 1: Write failing tests with an injected process runner**

```ts
const result = await parallelSearch(
  [{ query: 'SessionManager', path: '/', mode: 'text' }],
  roots,
  { platform: 'linux', commandExists: async (name) => name === 'rg', run: fakeRun },
);
assert.equal(result.results[0]!.backend, 'rg');
assert.equal(result.results[0]!.matches[0]!.path, '/src/session.ts');
```

Also cover regex, files, no-match exit code, invalid regex, timeout, output caps, spaces/unicode, include/exclude globs, and fallback argument construction.

- [ ] **Step 2: Run executor tests and confirm failure because module is missing**
- [ ] **Step 3: Implement bounded process runner and adapters**

Use `spawn(executable, args, { shell: false, cwd })`. Treat backend no-match status as an empty successful result. Kill on timeout and cap collected output.

Resolve query roots before spawning. Normalize native paths back to logical paths, classify each match, omit secrets, and mask sensitive text.

- [ ] **Step 4: Run executor tests and confirm pass**

### Task 3: Worker dispatch and service authorization

**Files:**
- Modify: `apps/worker/src/dispatcher.ts`
- Modify: `packages/mcp-tools/src/service.ts`
- Create: `packages/mcp-tools/src/search-tool.ts`
- Modify: `packages/mcp-tools/src/service-types.ts` if settings typing needs extension
- Test: `packages/mcp-tools/test/service.integration.test.ts` or nearest service test
- Test: `apps/worker/test/dispatcher.unit.test.ts` or nearest worker dispatch test

**Interfaces:**
- Produces: `searchTool(context, sessionId, args)` which enforces settings and `files.search` authorization before worker execution.

- [ ] **Step 1: Add failing service tests**

Cover authorization, explicit workspace targeting, default limit 8, configured limit, rejecting `queries.length > configured`, capping `maxResults`, and forwarding one signed `search.parallel` worker operation.

- [ ] **Step 2: Run focused tests and confirm failure**
- [ ] **Step 3: Implement service handler and worker dispatch**

Read settings with:

```ts
const configured = context.deps.settings?.get('execution.settings', {}) ?? {};
const maxQueries = clamp(Number((configured as any).searchMaxParallelQueries ?? 8), 1, 32);
```

Authorize once with capability `files.search`, resolve the workspace lease, and pass normalized queries to the worker. Reject over-limit calls with `INVALID_REQUEST` rather than truncating client intent.

- [ ] **Step 4: Run focused tests and confirm pass**

### Task 4: Settings API and UI

**Files:**
- Modify: `apps/core/src/admin/routes/settings-routes.ts`
- Modify: `apps/web-react/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web-react/src/features/settings/settings-service.ts` only if a stronger execution-settings type is introduced
- Test: relevant admin route and React settings tests

**Interfaces:**
- Extends `/api/execution-settings` with `searchMaxParallelQueries` and `searchMaxResultsPerQuery`.

- [ ] **Step 1: Add failing admin validation tests for defaults and clamping/rejection**
- [ ] **Step 2: Add failing UI test for Search settings controls**
- [ ] **Step 3: Implement validated API persistence and compact Search UI**

Persist numeric values only after validating `searchMaxParallelQueries` in `1..32` and positive result limits. Preserve unrelated execution settings during PATCH.

- [ ] **Step 4: Run admin/UI tests and confirm pass**

### Task 5: Modern MCP integration

**Files:**
- Modify: `apps/core/test/mcp-modern.integration.test.ts`

**Interfaces:**
- Verifies `tools/list` and `tools/call` with `Mcp-Name: search`.

- [ ] **Step 1: Add an HTTP test that lists and calls `search` under MCP `2026-07-28`**
- [ ] **Step 2: Verify no `Mcp-Session-Id` is emitted and structured content contains grouped search results**
- [ ] **Step 3: Run modern MCP integration tests**
