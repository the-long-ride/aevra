# Permissions & Admin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch permission grants, table/modal workspace UX, improved non-Remote-Access Settings layout, audit clearing, and safe bulk session revocation in Web UI and CLI.

**Architecture:** Add narrowly scoped admin bulk actions and service methods while keeping existing single-record APIs. Add a web enhancement module/styles loaded after the existing app so Remote Access remains untouched and the targeted pages can be progressively replaced without rewriting `apps/web/app.js`.

**Tech Stack:** TypeScript, Node.js built-in test runner, SQLite, vanilla browser JavaScript/CSS.

**Spec:** `docs/superpowers/specs/2026-08-18-permissions-admin-ux-design.md`

## Global Constraints
- Keep Remote Access behavior/layout intact.
- Existing single-record APIs remain compatible.
- Audit clear preserves hash-chain continuity through the checkpoint.
- Revoke-others preserves the current admin session and connector-originated MCP sessions.
- Destructive CLI actions require `--yes`.

---

### Task 1: Bulk admin backend actions

**Files:**
- Create: `apps/core/src/admin/bulk-actions.ts`
- Modify: `apps/core/src/admin/server.ts`
- Modify: `apps/core/src/admin/bootstrap.ts`
- Modify: `apps/core/src/policy/capabilities.ts`
- Test: `apps/core/test/admin-control-plane.integration.test.ts`

**Interfaces:**
- Produces `handleBulkAdminAction(req,res,url,context,currentAdminSession)`.
- Produces `AdminBootstrapService.revokeAllExcept(sessionId)`.
- Produces `CapabilityProfileService.listMappings(workspaceId)`.

- [ ] Add tests for bulk rule creation, workspace admission listing, and revoke-others preservation.
- [ ] Implement focused bulk endpoints and helper methods.
- [ ] Verify relevant core tests.

### Task 2: Audit clearing

**Files:**
- Modify: `packages/store/src/audit.ts`
- Modify: `apps/core/src/audit/audit-service.ts`
- Test: `apps/core/test/audit.unit.test.ts`
- Test: `apps/core/test/admin-control-plane.integration.test.ts`

**Interfaces:**
- Produces `AuditRepository.clearWithCheckpoint()`.
- Produces `AuditService.clear()` returning removed count.

- [ ] Add tests proving clear removes rows and leaves `verify()` valid.
- [ ] Implement checkpoint-preserving clear.
- [ ] Verify audit/core tests.

### Task 3: CLI admin cleanup commands

**Files:**
- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/cli-support.ts`
- Test: CLI tests under `apps/cli/test`.

**Interfaces:**
- `aevra audit clear --yes`
- `aevra sessions revoke-others --yes`

- [ ] Add parser/help tests for both commands and `--yes` requirement.
- [ ] Implement parser, help text, and admin API calls.
- [ ] Verify CLI tests.

### Task 4: Web UX enhancements

**Files:**
- Create: `apps/web/admin-enhancements.js`
- Create: `apps/web/admin-enhancements.css`
- Modify: `apps/web/index.html`

**Interfaces:**
- Permissions page calls `/api/permissions/bulk` and existing permission delete API.
- Workspace modal calls existing mount/admission APIs plus `/api/workspaces/:id/admissions`.
- Sessions page calls `/api/sessions/revoke-others`.
- Audit page calls `DELETE /api/audit`.
- Settings keeps the existing `.remote-card` DOM node and re-renders only other sections.

- [ ] Implement active-page enhancement observer.
- [ ] Implement Permissions Add rules modal + rules data table.
- [ ] Implement Workspaces data table + always-visible detail modal sections + multiple external mount table.
- [ ] Implement Sessions and Audit bulk actions with confirmation.
- [ ] Re-layout non-Remote-Access Settings into compact panels/tables.
- [ ] Add responsive modal/table styles.

### Task 5: Verification

- [ ] Run `npm test` when a runnable checkout is available.
- [ ] Run `npm run lint` when available.
- [ ] Run `npm run build`.
- [ ] Review diff for Remote Access regressions and destructive-action confirmation paths.
