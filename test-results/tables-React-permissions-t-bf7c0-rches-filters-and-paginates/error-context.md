# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tables.spec.ts >> React permissions table searches filters and paginates
- Location: tests\ui-parity\tables.spec.ts:24:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('actor-29')
Expected: visible
Error: strict mode violation: getByText('actor-29') resolved to 2 elements:
    1) <option value="actor-29">actor-29</option> aka getByLabel('Connector / actorAllactor-')
    2) <td data-priority="normal" data-label="Connector / actor">actor-29</td> aka getByRole('cell', { name: 'actor-' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('actor-29')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: A
      - generic [ref=e7]:
        - strong [ref=e8]: Aevra v0.5.0
        - generic [ref=e9]: Local MCP control plane
    - generic [ref=e10]:
      - generic [ref=e11]:
        - generic [ref=e12]: Core
        - generic [ref=e15]: Worker
        - generic [ref=e18]: MCP
        - generic [ref=e21]: Tunnel
      - button "Switch to dark mode" [ref=e24] [cursor=pointer]: "[light]"
      - button "Requests 0" [ref=e25] [cursor=pointer]:
        - text: Requests
        - generic [ref=e26]: "0"
  - navigation "Aevra admin" [ref=e27]:
    - button "Dashboard" [ref=e28] [cursor=pointer]
    - button "Workspaces" [ref=e29] [cursor=pointer]
    - button "Permissions" [ref=e30] [cursor=pointer]
    - button "Sessions" [ref=e31] [cursor=pointer]
    - button "Processes" [ref=e32] [cursor=pointer]
    - button "Changes" [ref=e33] [cursor=pointer]
    - button "Audit" [ref=e34] [cursor=pointer]
    - button "Settings" [ref=e35] [cursor=pointer]
    - button "Guide" [ref=e36] [cursor=pointer]
  - main [ref=e37]:
    - generic [ref=e38]:
      - generic [ref=e39]:
        - heading "Permissions" [level=2] [ref=e40]
        - paragraph [ref=e41]: Create connector permission records and manage remembered rules.
      - button "Add rules" [ref=e42] [cursor=pointer]
    - generic [ref=e44]:
      - generic [ref=e45]:
        - generic [ref=e46]:
          - generic [ref=e47]: Search
          - searchbox "Search" [active] [ref=e48]: actor-29
        - generic [ref=e49]:
          - generic [ref=e50]:
            - generic [ref=e51]: Effect
            - combobox "Effect" [ref=e52]:
              - option "All" [selected]
              - option "allow"
              - option "deny"
          - generic [ref=e53]:
            - generic [ref=e54]: Capability
            - combobox "Capability" [ref=e55]:
              - option "All" [selected]
              - option "commands.run"
              - option "files.read"
          - generic [ref=e56]:
            - generic [ref=e57]: Scope
            - combobox "Scope" [ref=e58]:
              - option "All" [selected]
              - option "workspace"
          - generic [ref=e59]:
            - generic [ref=e60]: Connector / actor
            - combobox "Connector / actor" [ref=e61]:
              - option "All" [selected]
              - option "actor-1"
              - option "actor-2"
              - option "actor-3"
              - option "actor-4"
              - option "actor-5"
              - option "actor-6"
              - option "actor-7"
              - option "actor-8"
              - option "actor-9"
              - option "actor-10"
              - option "actor-11"
              - option "actor-12"
              - option "actor-13"
              - option "actor-14"
              - option "actor-15"
              - option "actor-16"
              - option "actor-17"
              - option "actor-18"
              - option "actor-19"
              - option "actor-20"
              - option "actor-21"
              - option "actor-22"
              - option "actor-23"
              - option "actor-24"
              - option "actor-25"
              - option "actor-26"
              - option "actor-27"
              - option "actor-28"
              - option "actor-29"
              - option "actor-30"
        - generic [ref=e62]:
          - generic [ref=e63]: Rows
          - combobox "Rows" [ref=e64]:
            - option "10"
            - option "25" [selected]
            - option "50"
            - option "100"
      - table [ref=e66]:
        - rowgroup [ref=e67]:
          - row [ref=e68]:
            - columnheader [ref=e69]:
              - button "Effect" [ref=e70] [cursor=pointer]
            - columnheader [ref=e71]:
              - button "Capability" [ref=e72] [cursor=pointer]
            - columnheader [ref=e73]:
              - button "Scope" [ref=e74] [cursor=pointer]
            - columnheader [ref=e75]:
              - button "Connector / actor" [ref=e76] [cursor=pointer]
            - columnheader [ref=e77]:
              - button "Matcher" [ref=e78] [cursor=pointer]
            - columnheader [ref=e79]
        - rowgroup [ref=e80]:
          - row [ref=e81]:
            - cell "allow" [ref=e82]
            - cell "files.read" [ref=e83]
            - cell "workspace" [ref=e84]
            - cell "actor-29" [ref=e85]
            - cell "*" [ref=e86]
            - cell [ref=e87]:
              - button "Revoke" [ref=e88] [cursor=pointer]
      - generic [ref=e89]:
        - generic [ref=e90]: 1–1 of 1
        - generic [ref=e91]:
          - button "«" [disabled] [ref=e92]
          - button "‹" [disabled] [ref=e93]
          - generic [ref=e94]: Page 1 / 1
          - button "›" [disabled] [ref=e95]
          - button "»" [disabled] [ref=e96]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { ADMIN_SURFACES, installAdminApi } from './fixtures';
  3  | 
  4  | const permissions = Array.from({ length: 30 }, (_, index) => ({
  5  |   id: `rule-${index + 1}`,
  6  |   effect: index % 2 === 0 ? 'allow' : 'deny',
  7  |   capability: index % 3 === 0 ? 'commands.run' : 'files.read',
  8  |   scope: 'workspace',
  9  |   actor: `actor-${index + 1}`,
  10 |   matcher: index % 3 === 0 ? 'git:status' : '*',
  11 | }));
  12 | 
  13 | const sessions = [
  14 |   {
  15 |     id: 'session-chatgpt',
  16 |     actor: 'ChatGPT',
  17 |     activeLeaseId: 'lease-1',
  18 |     lease: { workspaceId: 'ws-1' },
  19 |   },
  20 |   { id: 'session-claude', actor: 'Claude', activeLeaseId: null, lease: null },
  21 | ];
  22 | 
  23 | for (const surface of ADMIN_SURFACES) {
  24 |   test(`${surface.name} permissions table searches filters and paginates`, async ({ page }) => {
  25 |     await installAdminApi(page, { permissions });
  26 |     await page.goto(surface.path);
  27 |     await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  28 |     await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  29 | 
  30 |     await expect(page.getByText('Page 1 / 2')).toBeVisible();
  31 |     const search = page.getByPlaceholder('Search permissions…');
  32 |     await search.fill('actor-29');
> 33 |     await expect(page.getByText('actor-29')).toBeVisible();
     |                                              ^ Error: expect(locator).toBeVisible() failed
  34 |     await search.fill('');
  35 | 
  36 |     const effect = page.getByLabel('Effect').first();
  37 |     await effect.selectOption('deny');
  38 |     await expect(page.getByText(/of 15$/)).toBeVisible();
  39 |   });
  40 | 
  41 |   test(`${surface.name} sessions table keeps actor and workspace-state filtering`, async ({
  42 |     page,
  43 |   }) => {
  44 |     await installAdminApi(page, { sessions });
  45 |     await page.goto(surface.path);
  46 |     await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  47 |     await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  48 | 
  49 |     const search = page.getByPlaceholder('Search remote sessions…');
  50 |     await search.fill('ChatGPT');
  51 |     await expect(page.getByText('session-chatgpt')).toBeVisible();
  52 |     await expect(page.getByText('session-claude')).toHaveCount(0);
  53 |     await expect(page.getByLabel('Actor')).toBeVisible();
  54 |     await expect(page.getByLabel('Workspace state')).toBeVisible();
  55 |   });
  56 | }
  57 | 
```