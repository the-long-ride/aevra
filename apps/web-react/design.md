# Aevra Web UI Design

## Direction

Aevra uses a terminal-native administrative interface inspired by the OpenCode design analysis supplied for this project. The interface should read like a modern manpage rather than a dashboard made of elevated cards: monospaced typography everywhere, flat surfaces, hairline rules, restrained geometry, and ASCII-like affordances.

The OpenCode source uses Berkeley Mono across the full system, a warm cream canvas (`#fdfcfc`), near-black ink (`#201d1d`), 4px interactive radii, sharp containers, semantic Apple-style accent colors, and no shadows or gradients. Aevra adopts that vocabulary while remaining an application UI rather than a marketing page.

Aevra must not bundle or redistribute Berkeley Mono. Use this stack instead:

```css
font-family:
  "JetBrains Mono",
  "IBM Plex Mono",
  ui-monospace,
  SFMono-Regular,
  Menlo,
  Monaco,
  Consolas,
  "Liberation Mono",
  "Courier New",
  monospace;
```

## Principles

1. Every visible text role uses a monospaced face.
2. Containers are flat. Use 1px rules instead of drop shadows.
3. Interactive controls use a 4px radius. Structural containers use 0px radius.
4. No gradients, atmospheric backgrounds, glassmorphism, or decorative imagery.
5. Use semantic colors only for status, warning, destructive, and success states.
6. Prefer ASCII-like markers (`[+]`, `[-]`, `[x]`, `+`, `−`) over decorative icons where practical.
7. Keep navigation horizontal on every breakpoint. On narrow screens it scrolls horizontally instead of wrapping or becoming a hamburger drawer.
8. All interactive controls should remain comfortably touchable on tablet and mobile.

## Theme Tokens

### Light

```text
canvas             #fdfcfc
surface-soft        #f8f7f7
surface-card        #f1eeee
ink                 #201d1d
ink-deep            #0f0000
charcoal            #302c2c
body                #424245
mute                #646262
stone               #6e6e73
ash                 #9a9898
hairline            rgba(15, 0, 0, 0.12)
hairline-strong     #646262
accent              #007aff
accent-hover        #0056b3
accent-active       #004085
warning             #ff9f0a
danger              #ff3b30
success             #30d158
```

### Dark

Dark mode is an Aevra-specific inversion of the same neutral system because the supplied OpenCode document only defines a light marketing canvas plus a limited dark TUI surface.

```text
canvas             #171515
surface-soft       #1e1b1b
surface-card       #292525
ink                #fdfcfc
ink-deep           #ffffff
charcoal           #e8e5e5
body               #d5d1d1
mute               #aaa5a5
stone              #908b8b
ash                #747070
hairline           rgba(253, 252, 252, 0.14)
hairline-strong    #646262
accent             #0a84ff
accent-hover       #409cff
accent-active      #0071e3
warning            #ff9f0a
danger             #ff453a
success            #32d74b
```

Theme selection is stored locally. When no Aevra preference exists, follow `prefers-color-scheme`.

## Typography

Use one type family across the entire application.

```text
page title          24px / 700 / 1.4
section title       16px / 700 / 1.5
body                14px / 400 / 1.5
body strong         14px / 500 / 1.5
button              14px / 500 / 1.5
caption             12px / 400 / 1.5
code                inherit mono stack
```

Avoid italics. Hierarchy should come from size, weight, spacing, and rules.

## Geometry

```text
interactive radius  4px
container radius    0px
pill radius         9999px only for status dots/counts when required
rule                1px solid var(--hairline)
strong rule         1px solid var(--hairline-strong)
shadow              none
```

## Spacing

Base rhythm is 8px with 4px and 12px intermediate steps.

```text
xs     4px
sm     8px
md     12px
lg     16px
xl     24px
xxl    32px
```

Administrative pages should stay compact; large marketing-style 96px section gaps are not used in the control plane.

## Application Shell

The shell has three horizontal regions:

1. Primary header: Aevra identity at left; runtime health, theme toggle, and Requests at right.
2. Safe-mode banner when active.
3. Horizontal page tabs.

The theme toggle sits immediately to the left of Requests and uses a text/ASCII-style label such as `[dark]` or `[light]` rather than a decorative SVG switch.

Page tabs never wrap. Use `display:flex`, `flex-wrap:nowrap`, `overflow-x:auto`, and `white-space:nowrap`. The active tab uses an underline/rule, not a filled pill.

## Navigation Behavior

React state is the immediate source of truth for programmatic navigation.

- Clicking a tab synchronously updates the selected React page.
- The same interaction writes the new hash using `history.pushState`.
- Browser Back/Forward is handled through `popstate` and derives the page from the current hash.
- A slow Dashboard fetch or polling completion must never change the active page.
- Empty or invalid hashes resolve to Dashboard only when interpreting the current URL, never as a side effect of an asynchronous page request.

## Dashboard

Runtime Overview contains operational counts only. Do not show a Version card because version is already present in the application header/runtime status.

Onboarding rules remain:

- Remote Access is the first section inside Onboarding.
- Before onboarding completes, Onboarding appears near the top.
- After completion, the entire Onboarding block moves to the bottom.
- User-expanded/collapsed section state survives polling refreshes.

Dashboard polling must be abort-safe on unmount and must not mutate routing state.

## Panels and Sections

Structural sections are flat rectangles with a hairline top/bottom or full border and no shadow. Avoid deeply nested card-on-card visuals.

Use headings such as:

```text
[+] Runtime overview
[+] Active connections
[-] Onboarding
```

where practical without making accessibility worse.

## Forms

Inputs and selects:

```text
height           40px minimum
background       surface-soft
border           1px hairline
radius           4px
padding          8px 12px
focus            canvas background + strong ink border
```

Textareas use the same surface and 12px padding. Do not use focus glow or box shadow.

Select option menus must remain readable in both themes.

Native host execution continues to show a warning that direct host access has no container isolation while Aevra permissions and approvals still apply.

## Buttons

Primary:

```text
background       ink
text             canvas
border           ink
radius           4px
height           36-40px
```

Secondary:

```text
background       canvas
text             ink
border           hairline-strong
radius           4px
```

Tabs are transparent and square, with the active state represented by text emphasis plus a bottom rule.

## Tables

Tables remain horizontally scrollable when necessary. On smaller screens prefer a stacked row representation when the existing DataTable can preserve labels clearly; otherwise keep a horizontal scroll container rather than clipping data.

Search, filter, pagination, and actions must stay reachable on phone widths.

## Requests Drawer and Modals

Requests remains accessible from every page. On desktop it may use a side drawer; on narrow screens it becomes a viewport-width sheet without overflowing horizontally.

Modal maximum dimensions must use viewport-relative sizing. Content areas scroll internally while action controls remain reachable.

## Responsive Behavior

### Desktop: >= 1024px

- Full horizontal tabs.
- Runtime health chips visible.
- Multi-column administrative grids where useful.
- Page max width remains bounded for readability.

### Tablet: 641px-1023px

- Horizontal tabs remain; scroll if necessary.
- Hide or condense lower-priority health text before hiding actions.
- Two-column forms/grids collapse when their minimum usable width is lost.
- Requests/theme controls remain visible.

### Mobile: <= 640px

- Single-column page grids and forms.
- Horizontal tab strip remains horizontally scrollable.
- Header identity may condense, but theme and Requests remain reachable.
- Tables use responsive rows or explicit horizontal scrolling.
- Long endpoints, hashes, paths, and code wrap or scroll safely.
- Page padding tightens to 12px.
- Touch targets are at least about 40px high where possible.

## React-only Runtime Contract

Aevra ships one web UI implementation.

- React is served at `/`.
- `aevra start --ui` opens `/`.
- `aevra start --ui-react` does not exist.
- `/react/` is not a supported admin destination.
- `apps/web` vanilla sources are removed.
- React Vite output writes directly to `dist/apps/web`.
- Core API, authentication, local bootstrap, permissions, approvals, and MCP behavior remain backend-owned and unchanged by the UI cutover.

## Accessibility

- Use semantic buttons, labels, tables, headings, and details elements.
- Preserve keyboard navigation.
- Theme toggle exposes its current state and target action to assistive technology.
- Focus is always visible without relying only on color.
- Do not use ASCII decoration as the only accessible label.

## Do

- Keep the interface flat, mono, compact, and text-forward.
- Use hairlines for structure.
- Preserve horizontal navigation at all widths.
- Keep status colors semantic and restrained.
- Test every important flow in light and dark themes.
- Test desktop, tablet, and mobile viewport behavior.

## Do Not

- Do not reintroduce a vanilla UI.
- Do not keep `/react/` as an alternate runtime path.
- Do not add shadows, gradients, glass effects, or rounded card stacks.
- Do not bundle Berkeley Mono.
- Do not turn mobile page tabs into a vertical list or hamburger menu.
- Do not let asynchronous Dashboard work control navigation.
