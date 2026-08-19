# Settings Native Execution + Navigation CSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep React and vanilla admin styling in parity, make top-tab routing hash-driven and stable, and add a safe Native host execution default.

**Architecture:** Shared CSS under `apps/web/styles` remains canonical for both surfaces. Navigation uses the URL hash as the only page-selection source. `native` is stored as an execution-setting choice but resolves to existing `host` execution before command risk/matcher/approval logic; the worker sandbox protocol remains Docker/Podman/Auto only.

**Tech Stack:** TypeScript, React, vanilla ES modules, Vitest, Node test contracts, Playwright parity tests.

**Spec:** `docs/superpowers/specs/2026-08-19-settings-native-navigation-css-design.md`

## Global Constraints

- Work directly on `main`; do not create a feature branch or PR.
- React and vanilla Settings behavior must remain equivalent.
- Top navigation remains a single horizontal row.
- `Auto` never silently falls back to native host.
- Native host must retain existing approvals, host-specific matchers, risk floors, workspace containment, audit, and CRITICAL one-time restrictions.
- Do not add CI/workflow files.

---

### Task 1: Hash-driven navigation regression

**Files:**
- Modify: `apps/web-react/src/app/App.test.tsx`
- Modify: `apps/web-react/src/app/use-hash-page.ts`
- Modify: `apps/web/main.js`
- Modify: `scripts/test/web-modular-entry.test.mjs`

**Interfaces:**
- Consumes: `AdminPageId`, current hash router.
- Produces: navigation where clicks update `location.hash` and `hashchange` owns page transitions.

- [ ] **Step 1: Write failing tests**

React: after clicking Settings and Guide, assert `window.location.hash` follows each destination; then set `window.location.hash = '#/permissions'`, dispatch `hashchange`, and assert Permissions renders.

Vanilla contract: assert `main.js` does not use `history.replaceState` for page navigation and does assign `location.hash` through a navigation helper.

- [ ] **Step 2: Run focused tests and confirm RED**

Run the React app test plus the modular-entry contract. Expected failure: current code still uses `replaceState`/manual activation.

- [ ] **Step 3: Implement minimal routing fix**

React `navigate(next)` only updates `window.location.hash = '#/' + next` when needed; it does not call `setPage(next)`.

Vanilla adds `navigate(page)` that updates `location.hash`; normal nav clicks call it, and `hashchange` calls `activate(page)` without rewriting history. Same-page Guide navigation may explicitly rerender Guide after changing `context.guideSlug`.

- [ ] **Step 4: Re-run focused tests and confirm GREEN**

- [ ] **Step 5: Commit navigation changes**

---

### Task 2: Native host execution default

**Files:**
- Modify: `packages/mcp-tools/test/service.integration.test.ts` or a focused command-tool integration test
- Modify: `packages/mcp-tools/src/command-tools.ts`
- Modify: `apps/core/src/operations/operation-service.ts`
- Modify: `apps/core/test/runtime.integration.test.ts` only if needed for resolver coverage

**Interfaces:**
- Consumes: `SettingsReader.get()`, existing `executionMode: 'sandbox' | 'host'`, host matcher/risk logic.
- Produces: `resolveExecutionMode(context, requestedMode)` behavior: explicit mode wins; otherwise `execution.settings.sandboxBackend === 'native'` => `host`, else `sandbox`.

- [ ] **Step 1: Write failing tests**

Test unspecified command mode with saved `{ sandboxBackend: 'native' }` and assert the worker receives `executionMode: 'host'`; assert host-specific matcher/risk behavior remains. Test explicit `executionMode: 'sandbox'` remains sandbox even when the saved backend is native.

- [ ] **Step 2: Run focused test and confirm RED**

Expected failure: current default is always sandbox.

- [ ] **Step 3: Implement minimal mode resolver**

Add a small helper in `command-tools.ts` that reads `execution.settings`. Use it in both `shellTool` and `commandTool` before command building/classification.

Expand `OperationService`'s settings resolver type to accept `native`. Before sending a sandbox operation to the worker, map `native` backend to `auto`; when `runCommand()` is called without an explicit mode, default to host only if saved backend is native.

- [ ] **Step 4: Re-run focused tests and confirm GREEN**

- [ ] **Step 5: Commit native execution behavior**

---

### Task 3: React + vanilla Settings parity and shared CSS refresh

**Files:**
- Modify: `apps/web-react/src/features/settings-guide.test.tsx`
- Modify: `apps/web-react/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/pages/settings-markup.js`
- Modify: `apps/web/pages/settings.js`
- Modify: `scripts/test/web-modular-surface.test.mjs`
- Modify: `apps/web/styles/tokens.css`
- Modify: `apps/web/styles/shell.css`
- Modify: `apps/web/styles/components.css`

**Interfaces:**
- Consumes: `/api/execution-settings` existing PATCH payload.
- Produces: fourth backend value `native`, contextual warning, consistent shared styling.

- [ ] **Step 1: Write failing parity/style tests**

Require `Native host`, the `native` option value, warning copy about no container isolation, and navigation CSS with `flex-wrap: nowrap`. Require refreshed dark select option styling/focus treatment from shared CSS.

- [ ] **Step 2: Run focused tests and confirm RED**

- [ ] **Step 3: Implement Settings UI**

Add `Native host` in React and vanilla. React tracks selected backend and conditionally renders the warning. Vanilla markup emits the warning and `settings.js` toggles it on select change.

- [ ] **Step 4: Implement shared CSS refresh**

Keep top nav horizontal with `flex-wrap: nowrap`; hide or thin its scrollbar without removing horizontal scrolling. Normalize control height/padding, dark `select`/`option` styling, `:focus-visible` outlines, panel/form spacing, and Execution warning presentation. Keep rules shared so React imports them unchanged.

- [ ] **Step 5: Re-run focused tests and confirm GREEN**

- [ ] **Step 6: Commit UI/CSS parity changes**

---

### Task 4: Verification

**Files:** none unless a failing verification exposes a regression.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence-backed completion report.

- [ ] **Step 1: Run focused source/unit tests**

Run navigation contracts, React settings/app tests, MCP command tests, vanilla modular tests, and syntax checks available in the working environment.

- [ ] **Step 2: Run broader verification if a full checkout is available**

Run `npm test`, `npm run typecheck`, and `npm run build`. If the environment still lacks a full checkout/dependencies, state that limitation explicitly and provide the exact local commands instead of claiming full verification.

- [ ] **Step 3: Confirm `.github/workflows` remains absent**

- [ ] **Step 4: Report final `main` HEAD and test evidence**
