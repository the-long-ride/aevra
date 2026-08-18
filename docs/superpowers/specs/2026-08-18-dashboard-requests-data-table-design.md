# Dashboard, Requests Drawer, Data Table, and Workspace UX Design

## Goal
Make Dashboard the single landing surface, keep Remote Access always visible at the top, move onboarding and connectors into Dashboard, move approvals into a header Requests drawer, and replace verbose listing pages with one reusable compact data-table pattern.

## Dashboard
Remote Access is the first section and never collapses. Onboarding is the renamed Getting Started section; it is expanded before completion and collapsed by default after completion. Runtime overview uses current-process data only and resets with Aevra. Connections contains static Bearer connectors; OAuth requests remain in Requests.

## Requests
The sticky header Requests button opens a right-side drawer. Pending OAuth, workspace, local-skill, and operation approvals are actionable cards. Completed operation approvals appear in a searchable/paginated History table. New requests do not force-open the drawer.

## Data table
A shared browser component provides client-side search, filters, sortable columns, page-size selection, pagination, responsive column priorities, and row actions. Workspaces, permissions, sessions, processes, changes, audit, connector list, tool metrics, and approval history use the component.

## Workspaces
The page shows one compact row per workspace with general information. Add Workspace is modal-based. Details opens a wide modal containing local root, description, external mounts and actor-admission configuration. Per-workspace configuration is not rendered inline in the main list.

## MCP structured results
MCP tools/call keeps human-readable JSON text content. `structuredContent` must always be an object. Existing object results are preserved; arrays and scalar results are wrapped as `{result: value}` so ChatGPT action validation never receives an invalid top-level list.

## Raw shell
This design does not expose unrestricted host PowerShell/bash. Existing `command_run` remains the execution boundary with capability, sandbox/host mode, network policy, risk classification, approval, audit, and timeout controls.
