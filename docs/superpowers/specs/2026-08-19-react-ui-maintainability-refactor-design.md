# React UI and Maintainability Refactor Design

Date: 2026-08-19
Status: Approved in conversation; awaiting written-spec review
Target branch: `main`

## Goals

Aevra will keep the current vanilla admin UI while adding a clean React + TypeScript implementation with feature/content/behavior parity and the same x.ai visual language. The React UI is not required to be screenshot-pixel-identical, but pages, labels, controls, data, ordering, dialogs, permission behavior, request actions, guide content, error states, and user-visible workflows must match the vanilla UI.

At the same time, the repository will adopt hard maintainability gates: real Prettier formatting, per-file LOC budgets, dead-code detection, real TypeScript checking, and at least 85% coverage for lines, statements, functions, and branches across maintained executable TypeScript/JavaScript source.

The refactor must remove obsolete code where behavior is already covered, split oversized files along meaningful responsibilities, and keep source readable. Minifying or compressing source to satisfy LOC limits is explicitly forbidden.

## Non-goals

- Do not replace or remove the vanilla UI.
- Do not create a second Core daemon, API surface, authentication model, policy engine, or database.
- Do not require pixel-identical screenshots between vanilla and React.
- Do not weaken command approvals, workspace containment, audit, DLP, or other Core security behavior.
- Do not add GitHub Actions or other CI workflows as part of this effort.
- Do not use generated/minified source as maintained application code.

## Runtime architecture

Both UIs run against the same Core/admin server, session cookie, API endpoints, request queue, permissions, workspaces, and persistence.

```text
https://localhost:<admin-port>/        -> vanilla UI
https://localhost:<admin-port>/react/ -> React UI
```

CLI behavior:

- `aevra start --ui` starts Aevra and opens the authenticated vanilla UI.
- `aevra start --ui-react` starts Aevra and opens the authenticated React UI.
- Passing both `--ui` and `--ui-react` is invalid and returns a clear CLI error.
- Existing `aevra ui` behavior remains vanilla unless a separate React launch command is explicitly added later.

The authenticated bootstrap route will support a narrowly validated destination. Only `/` and `/react/` are allowed. Arbitrary redirects are rejected so the change cannot become an open-redirect primitive.

## React application structure

The React application lives independently from the vanilla implementation while sharing contracts with it.

```text
apps/
  web/                         # vanilla UI
    pages/
    components/
    services/
    styles/
    index.html

  web-react/
    index.html
    vite.config.ts
    src/
      app/                     # root shell, navigation, providers
      components/              # reusable presentation primitives
      features/
        dashboard/
        permissions/
        workspaces/
        sessions/
        audit/
        settings/
        processes/
        changes/
        guide/
        requests/
      hooks/
      services/                # typed same-origin admin API client
      styles/
      main.tsx

packages/
  admin-contracts/             # shared admin surface/types/parity metadata
```

### React boundaries

- Feature modules own page-specific state and behavior.
- Shared components are presentation-oriented and do not contain Core policy.
- API calls are centralized in typed services rather than embedded throughout components.
- Core remains the source of truth for authorization, command matching, approval scopes, workspace admission, audit, and security decisions.
- Avoid barrel-file-heavy architecture; import feature modules directly where practical.
- Independent API requests should start in parallel rather than creating serial waterfalls.
- Expensive or frequently refreshed sections should be isolated so updates do not cause unnecessary whole-page re-renders.
- Global listeners and polling loops must have one owner and deterministic cleanup.

## Shared admin contracts and parity

`packages/admin-contracts` defines the expected user-visible admin surface without moving business logic into the client. It includes stable contracts such as:

- navigation destinations;
- page and section identifiers;
- key actions and labels;
- permission capability names;
- approval scopes;
- request presentation fields;
- table feature expectations;
- guide chapter identifiers;
- onboarding section identifiers and ordering states.

Parity tests consume this contract from both implementations. The goal is to avoid maintaining two unrelated lists of what the product is supposed to show.

Parity means both UIs expose the same meaningful workflow and state, including:

- Dashboard runtime information and active connections;
- Onboarding and Remote Access;
- Permissions CRUD and command matcher presentation;
- Workspaces and mounts;
- Sessions and workspace switching;
- Requests and approval scopes;
- Processes and changes;
- Audit;
- Settings;
- Guide content and Safe Command Matchers;
- connector creation/revoke and OAuth-related state where exposed by the current vanilla UI.

## Dashboard onboarding behavior

This behavior applies to both vanilla and React.

### Before onboarding is complete

The Dashboard places Onboarding near the top and expanded by default. Remote Access is the first full-width block inside Onboarding.

Order inside Onboarding:

1. Remote Access
2. Connect an AI
3. Workspace
4. Try Aevra
5. Finish onboarding

Remote Access retains all existing Cloudflare controls and behavior; only its containment/order changes.

### After onboarding is complete

The entire Onboarding panel, including Remote Access, moves to the bottom of the Dashboard after the normal runtime/activity sections. It remains collapsible. Initial render may default to expanded, but once the user collapses it, periodic dashboard refresh must not force it open again.

Stale copy saying Remote Access remains above Onboarding must be removed.

## Build and static serving

The build has two UI outputs but one runtime server.

1. Build TypeScript/Core/CLI packages.
2. Build `apps/web-react` with Vite.
3. Copy vanilla static assets to `dist/apps/web/`.
4. Copy the React build to `dist/apps/web/react/`.
5. The existing admin static server serves both paths from the same origin.

The build scripts themselves are subject to the same formatting and LOC limits and should be split into small helpers when necessary.

## Formatting policy

Prettier becomes the canonical formatter for maintained source.

Required commands:

```text
npm run format
npm run format:check
```

`format:check` must call Prettier in check mode rather than only checking CRLF/final-newline conventions. Existing newline requirements may remain as an additional check.

All maintained `.ts`, `.tsx`, `.js`, and `.css` source must be readable, normally formatted source. Deliberately placing large modules on one line or otherwise minifying source to reduce physical LOC is a lint failure.

## LOC policy

The LOC policy applies to every tracked file with these extensions, including tests:

- `.ts`: maximum 350 physical lines
- `.tsx`: maximum 400 physical lines
- `.js`: maximum 350 physical lines
- `.css`: maximum 500 physical lines

Only generated/vendor output is excluded, such as:

- `dist/`
- `node_modules/`
- coverage output
- test/build output directories
- third-party vendored/generated files explicitly identified as such

The checker must operate on Git-tracked files so ignored build artifacts do not affect results. LOC is measured after Prettier formatting.

`npm run lint:loc` fails with each offending file and its line count/limit.

## Splitting strategy

Oversized files are not split arbitrarily. Extract units that each have one clear responsibility and sensible names.

Expected early candidates include:

- `apps/core/src/admin/routes/api.ts` -> route groups such as workspace, permission, approval, session, connector, settings, audit, and execution routes;
- `apps/cli/src/cli.ts` -> command-specific handlers plus a thin dispatch entry point;
- large OAuth/auth modules -> protocol/validation/storage or endpoint-oriented helpers where appropriate;
- vanilla UI monoliths -> page modules, shared components, API services, request/dashboard helpers, and focused style sheets;
- large tests -> fixture/builders plus focused behavior suites, while keeping tests under the same LOC limits.

Public interfaces should remain stable unless a change is necessary for cleaner boundaries. Internal v2/v3 compatibility layers may be removed once parity/regression tests demonstrate that no supported behavior depends on them.

## Dead-code policy

Dead-code removal is part of the refactor, but static analysis is not sufficient evidence by itself for deletion.

Tooling:

- Knip for unused files, exports, and dependencies.
- TypeScript with semantic checking and unused-local/unused-parameter detection.
- Existing repository-specific security lint rules remain active.

Deletion requirements:

- obvious unreachable/internal code may be removed directly when covered by surrounding tests;
- dynamically referenced CLI/MCP/browser entry points must be verified before deletion;
- public or integration-facing behavior needs regression coverage before obsolete implementation is removed.

## Type checking

The current `tsc --noEmit --noCheck` command is not a semantic type check. The new `npm run typecheck` must perform real TypeScript checking.

The React application gets its own TS configuration as needed, but the top-level typecheck command must cover Core/CLI/packages and React source.

## Testing strategy

Refactoring follows behavior-first TDD where practical:

1. capture current supported behavior with tests;
2. add failing tests for new requirements;
3. implement/refactor minimally;
4. run focused tests;
5. run the complete local verification suite before declaring the batch complete.

### Backend/CLI

Existing Node test-runner tests remain supported. Add focused unit, contract, integration, and security tests where coverage is missing, especially around extracted route/CLI modules.

### Vanilla UI

Keep source-level tests only where they protect static contracts that are difficult to exercise otherwise. Prefer behavior-oriented tests for extracted client logic and parity-sensitive flows. The vanilla refactor must preserve existing actions and data presentation.

### React UI

Use Vitest + React Testing Library + jsdom for component/integration tests. Test user-visible behavior rather than component internals.

Important React coverage includes:

- navigation and page rendering;
- Dashboard and onboarding ordering;
- Remote Access forms/actions;
- tables, search, filters, pagination;
- permissions and command matcher display;
- request approval scopes including CRITICAL once-only behavior as presented by the server;
- Workspaces and Sessions actions;
- settings forms;
- Guide and Copy All behavior;
- error/loading/empty states;
- periodic refresh that preserves local collapsible state.

### Cross-UI parity tests

Add a parity suite using the shared contract. It must verify the same key pages, sections, actions, labels, and workflow states exist in vanilla and React.

A small browser-level smoke suite should exercise equivalent high-value workflows in both UIs against the same API contract. Exact screenshot identity is not required.

## Coverage gate

Maintained executable `.ts`, `.tsx`, and `.js` source must meet all four repository coverage thresholds:

- lines >= 85%
- statements >= 85%
- functions >= 85%
- branches >= 85%

Coverage exclusions are limited to generated output, declarations, configuration-only files, and explicit test fixtures with no executable production behavior. Tests remain subject to formatting and LOC rules even though test files are not themselves coverage targets.

CSS does not receive a meaningless statement/branch percentage. CSS behavior is protected through component/browser tests and targeted style-contract checks.

The aggregate coverage command must fail locally when any required threshold is below 85%.

## Lint and verification commands

The intended local toolchain is:

```text
npm run format
npm run format:check
npm run lint
npm run lint:loc
npm run lint:deadcode
npm run typecheck
npm test
npm run test:coverage
npm run build
```

`npm run lint` should aggregate repository lint rules without hiding the focused commands. Developers can still run `lint:loc` or `lint:deadcode` directly for faster feedback.

The final implementation is not considered complete until these commands pass locally from a clean working tree with current dependencies installed.

## Implementation order

1. Add regression tests for the approved Onboarding/Remote Access behavior.
2. Establish real Prettier, semantic typecheck, LOC checker, dead-code tooling, and coverage harness.
3. Prettier-format the maintained source, then inventory real LOC violations.
4. Split oversized backend/CLI/vanilla files by responsibility until LOC checks pass.
5. Remove verified dead code and stale compatibility paths while keeping regression coverage green.
6. Add shared admin contracts/parity metadata.
7. Add React/Vite/TypeScript app shell and typed API client.
8. Implement React features page-by-page against the parity contract.
9. Add `--ui-react`, same-origin `/react/` serving, and safe authenticated bootstrap destination handling.
10. Bring both UI test suites and cross-UI parity coverage to the required thresholds.
11. Run full local format, lint, dead-code, typecheck, test, coverage, and build verification repeatedly until all gates pass.

## Acceptance criteria

The work is accepted only when all of the following are true:

- vanilla UI remains available through `aevra start --ui`;
- React UI is available through `aevra start --ui-react`;
- both UIs use the same Core/API/authentication state;
- React has feature/content/behavior parity with vanilla and follows the same x.ai visual language;
- Remote Access is inside Onboarding in both UIs;
- completed Onboarding is placed at the Dashboard bottom in both UIs;
- source is Prettier-formatted and non-minified;
- every tracked maintained TS/TSX/JS/CSS file respects the configured LOC limit;
- dead-code checks pass and removed code has appropriate behavioral protection;
- real semantic TypeScript checking passes;
- maintained executable TS/TSX/JS meets at least 85% lines/statements/functions/branches coverage;
- the full local test suite passes;
- both UI builds are packaged into `dist` and open through authenticated local launch;
- no GitHub Actions workflow is introduced by this effort.
