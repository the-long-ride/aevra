# Dashboard and MCP UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the dashboard-first UI, Requests notification drawer, common data table, compact workspace modal workflow, and ChatGPT-safe MCP structured result serialization.

**Architecture:** Preserve the existing web shell and APIs, then layer a focused v2 UI router after the legacy renderer. A standalone data-table component owns list interaction state. MCP serialization is corrected at the JSON-RPC boundary rather than modifying every individual tool result.

**Tech Stack:** Browser JavaScript/CSS, Node.js 22 tests, TypeScript MCP server.

**Spec:** `docs/superpowers/specs/2026-08-18-dashboard-requests-data-table-design.md`

## Global Constraints
- Remote Access is always visible at the top of Dashboard.
- Onboarding is collapsed after completion but remains expandable.
- Requests are opened from the sticky header rather than a nav page.
- Listing views share search, filter, sort, page-size and pagination behavior.
- Raw unrestricted host shell is not introduced.

### Task 1: MCP structured content
- Add a contract test reproducing `file_list` returning an array.
- Normalize non-object structured results at `handleJsonRpc`.
- Preserve object structured results unchanged.

### Task 2: Common data table
- Add `apps/web/data-table.js` with search/filter/sort/page-size/pagination state.
- Add responsive column priorities and row-action dispatch.

### Task 3: Dashboard and Requests
- Add `apps/web/app-v2.js` and `apps/web/app-v2.css`.
- Remove Getting Started, Approvals and Connectors from visible navigation.
- Render Remote Access first, then collapsible Onboarding, runtime stats, tool usage, connections and recent runtime activity.
- Open approvals as a right-side Requests drawer.

### Task 4: Compact listing pages
- Render Workspaces, Permissions, Sessions, Processes, Changes and Audit using the shared table.
- Move workspace configuration to details/add modals.

### Task 5: Build and regression coverage
- Load v2 assets from `index.html`.
- Add static web tests for dashboard composition, request drawer, data-table controls and workspace modal.
- Extend `test:web` and build syntax checks for the new browser scripts.
