# Workspace Approval and Responsive UI Design

## Goal

Make workspace admission requests created by remote AI clients visible and actionable in the local Aevra UI, while tightening the persistent header, onboarding behavior, connection-guide layout, and responsive status presentation.

## Root Cause

`workspace_select` currently calls `SessionManager.switchWorkspace()`. For an unknown actor/workspace mapping, that returns `approval-required`, but `McpToolService` only returns `{status:'approval_required'}` to the MCP client. It never creates an `ApprovalService` ticket. The local UI polls `/api/approvals`, so there is no record to display, no request badge increment, and no local/browser notification.

## Workspace Admission Flow

Unknown OAuth actor + workspace selection must create a real approval ticket with family `workspace:select`, workspace ID, session ID, actor, requested workspace, and a session-only default capability profile (`developer`).

The first `workspace_select` call returns `approval_pending` with a `requestId`. Repeated calls for the same session/workspace reuse the existing pending ticket rather than creating duplicates. After local approval, the next `workspace_select` resumes that approved ticket and creates the workspace lease using the frozen `developer` profile. Denied/expired/cancelled requests are not silently admitted.

This approval is admission-specific. The local UI must not offer workspace/global remembered operation-permission scopes for it. It shows Allow and Deny only. Persistent actor/workspace admission remains managed by the existing workspace admission mapping UI.

## Request Visibility

The header request count combines pending OAuth pairing requests and pending operation/admission approval tickets. A workspace admission ticket therefore immediately appears in Approvals, increments Requests, emits an in-app toast, and emits a browser notification when permission is already granted. Pending requests found on first page load are surfaced too; they are not silently seeded.

## Header

The application header remains sticky at the top of the local Web UI. It shows the Aevra version and compact status chips for Core, Worker, MCP, and Tunnel.

Each chip uses a small status dot instead of the word `running`:

- green pulsing dot: running / reachable / connected
- amber pulsing dot: starting / checking / reconnecting
- red solid dot: stopped / unavailable due to failure / configured tunnel unreachable
- gray solid dot: not configured / intentionally unavailable

Worker means the local Execution Worker, not the Cloudflare tunnel. Tunnel uses `/api/status.tunnel`, `tunnelReachable`, and `tunnelCheckedAt`.

## Getting Started

Remote Access is always visible, before and after onboarding completion.

Before completion, the remaining onboarding sections are expanded normally. After Finish onboarding, only these sections collapse under a persistent `Getting Started · Completed` details row:

- Connect an AI
- Workspace
- Try Aevra
- Explore

The details row defaults closed in every new browser session but can be expanded temporarily. Remote Access is never moved into the collapsed container.

## Connect an AI

Remove the Pairing requests column from Getting Started. Pairing approvals live exclusively on the Approvals page and through the header request indicator.

`Connect an AI` is explicitly labeled as example setup guidance. It displays provider examples in parallel cards for ChatGPT, Claude, and Gemini. Each card uses the canonical MCP endpoint, states OAuth as the normal authentication path, and links to the provider-specific local guide. Provider wording is presented as example guidance because external UI labels may differ.

Desktop uses three columns, medium widths use two columns, and narrow/mobile widths use one column.

## Responsive Layout

The sticky header can wrap status chips without overlapping content. Navigation remains usable at desktop/tablet/mobile widths. Setup cards, Remote Access fields, provider example cards, action rows, forms, endpoints, and approval cards must collapse cleanly with no horizontal overflow.

At narrow widths, status chips remain compact and horizontally scroll/wrap rather than forcing the page wider than the viewport. Touch targets remain at least 44px in the existing mobile breakpoint.

## Testing

Add regression coverage for:

1. unknown workspace selection creates and reuses an approval ticket;
2. approved workspace admission resumes to a selected lease;
3. admission approval does not create persistent operation permission rules;
4. web runtime surfaces first-load pending requests;
5. Remote Access remains outside completed onboarding collapse;
6. Getting Started no longer contains Pairing requests and includes three example provider cards;
7. sticky header, status-dot states, tunnel chip, and responsive CSS contracts.

No CI workflow configuration changes are part of this work.