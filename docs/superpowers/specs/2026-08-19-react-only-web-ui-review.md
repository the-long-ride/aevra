# React-only Web UI Spec Self-review

Reviewed: 2026-08-19

## Placeholder scan

No `TODO`, `TBD`, or unresolved implementation placeholders remain in the approved design/spec.

## Consistency checks

- React is the only shipped UI.
- `/` is the only supported application root.
- `--ui-react` is removed rather than retained as an alias.
- Mobile admin page tabs remain horizontal and scrollable; this intentionally overrides the hamburger guidance in the source OpenCode marketing analysis.
- Berkeley Mono is referenced only as source-design context and is never bundled or redistributed.
- Dark mode is explicitly identified as an Aevra adaptation because the supplied source does not define a complete dark application theme.
- Runtime Overview removes only the Version tile; version may remain in the header/runtime status.
- Dashboard polling is independent from navigation state.
- Programmatic navigation is synchronous React state plus `history.pushState`; Back/Forward is `popstate`.
- Existing backend APIs, security policy, approvals, permissions, and onboarding semantics remain unchanged.

## Scope check

This is a single architectural cutover because the UI removal, root routing, build output, CLI flag removal, design system, theme state, and responsive behavior all converge on one React-only application contract.

## Ambiguity resolutions

- `aevra start --ui` means launch the React UI at `/`.
- `aevra start --ui-react` must fail as an unknown option after removal.
- `/react/` is not a compatibility alias.
- Theme persistence is local-browser state, not a Core setting.
- Theme toggle sits immediately before Requests in DOM and visual order.
- Horizontal navigation does not wrap at mobile widths.
- Responsive tables may stack rows or horizontally scroll depending on the existing DataTable semantics, but they must never clip controls or data.
