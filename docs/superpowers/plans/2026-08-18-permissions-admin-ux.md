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
- Revoke-others preserves the current admin session plus OAuth and static connector MCP sessions.
- New bulk mutations obey Safe Mode and existing critical-operation persistence restrictions.
- Destructive CLI actions require `--yes`.

---

### Task 1: Bulk admin backend actions

**Files:**
- Create: `apps/core/src/admin/bulk-actions.ts`
- Modify: `apps/core/src/admin/server.ts`
- Modify: `apps/core/src/admin/bootstrap.ts`
- Modify: `apps/core/src/policy/capabilities.ts`
- Test: `apps/core/test/admin-bulk-actions.integration.test.ts`

**Interfaces:**
- Produces `handleBulkAdminAction(req,res,url,context,currentAdminSession)`.
- Produces `AdminBootstrapService.revokeAllExcept(sessionId)`.
- Produces `CapabilityProfileService.listMappings(workspaceId)`.

- [x] Add tests for bulk rule creation, critical-rule rejection, Safe Mode, workspace admission listing, and revoke-others preservation.
- [x] Implement focused bulk endpoints and helper methods.
- [ ] Verify relevant core tests in CI.

### Task 2: Audit clearing

**Files:**
- Modify: `packages/store/src/audit.ts`
- Modify: `apps/core/src/audit/audit-service.ts`
- Test: `apps/core/test/audit-clear.unit.test.ts`
- Test: `apps/core/test/admin-bulk-actions.integration.test.ts`

**Interfaces:**
- Produces `AuditRepository.clearWithCheckpoint()`.
- Produces `AuditService.clear()` returning removed count.

- [x] Add tests proving clear removes rows and leaves `verify()` valid.
- [x] Implement checkpoint-preserving clear.
- [ ] Verify audit/core tests in CI.

### Task 3: CLI admin cleanup commands

**Files:**
- Modify: `apps/cli/src/args.ts`
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/cli-support.ts`
- Test: `apps/cli/test/admin-maintenance-args.unit.test.ts`

**Interfaces:**
- `aevra audit clear --yes`
- `aevra sessions revoke-others --yes`

- [x] Add parser/help tests for both commands and `--yes` requirement.
- [x] Implement parser, help text, and admin API calls.
- [ ] Verify CLI tests in CI.

### Task 4: Web UX enhancements

**Files:**
- Create: `apps/web/admin-enhancements.js`
- Create: `apps/web/admin-enhancements.css`
- Modify: `apps/web/index.html`
- Modify: `package.json`
- Test: `scripts/test/web-admin-enhancements.test.mjs`

**Interfaces:**
- Permissions page calls `/api/permissions/bulk` and existing permission delete API.
- Workspace modal calls existing mount/admission APIs plus `/api/workspaces/:id/admissions`.
- Sessions page calls `/api/sessions/revoke-others`.
- Audit page calls `DELETE /api/audit`.
- Settings keeps the existing `.remote-card` DOM node and re-renders only other sections.

- [x] Implement active-page enhancement observer.
- [x] Implement Permissions Add rules modal + rules data table.
- [x] Implement Workspaces data table + always-visible detail modal sections + multiple external mount table.
- [x] Implement Sessions and Audit bulk actions with confirmation.
- [x] Re-layout non-Remote-Access Settings into compact panels/tables.
- [x] Add responsive modal/table styles.
- [x] Add web syntax/asset coverage.

### Task 5: Verification

- [ ] Run `npm run format:check` in PR CI.
- [ ] Run `npm run lint` in PR CI.
- [ ] Run `npm test` in PR CI.
- [ ] Run `npm run typecheck` in PR CI.
- [ ] Run `npm run build` in PR CI.
- [ ] Review diff for Remote Access regressions and destructive-action confirmation paths.
