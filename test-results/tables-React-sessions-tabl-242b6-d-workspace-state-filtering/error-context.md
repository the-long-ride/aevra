# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tables.spec.ts >> React sessions table keeps actor and workspace-state filtering
- Location: tests\ui-parity\tables.spec.ts:41:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Sessions' })
Expected: visible
Error: strict mode violation: getByRole('heading', { name: 'Sessions' }) resolved to 3 elements:
    1) <h2>Sessions</h2> aka getByRole('heading', { name: 'Sessions', exact: true })
    2) <h3>Remote MCP sessions</h3> aka getByRole('heading', { name: 'Remote MCP sessions' })
    3) <h3>Local admin sessions</h3> aka getByRole('heading', { name: 'Local admin sessions' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Sessions' })

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
    - button "Sessions" [active] [ref=e31] [cursor=pointer]
    - button "Processes" [ref=e32] [cursor=pointer]
    - button "Changes" [ref=e33] [cursor=pointer]
    - button "Audit" [ref=e34] [cursor=pointer]
    - button "Settings" [ref=e35] [cursor=pointer]
    - button "Guide" [ref=e36] [cursor=pointer]
  - main [ref=e37]:
    - generic [ref=e38]:
      - generic [ref=e39]:
        - heading "Sessions" [level=2] [ref=e40]
        - paragraph [ref=e41]: Manage MCP and local admin sessions.
      - button "Revoke all others" [ref=e42] [cursor=pointer]
    - generic [ref=e43]:
      - heading "Remote MCP sessions" [level=3] [ref=e45]
      - generic [ref=e46]:
        - generic [ref=e47]:
          - generic [ref=e48]:
            - generic [ref=e49]: Search
            - searchbox "Search" [ref=e50]
          - generic [ref=e51]:
            - generic [ref=e52]:
              - generic [ref=e53]: Actor
              - combobox "Actor" [ref=e54]:
                - option "All" [selected]
                - option "ChatGPT"
                - option "Claude"
            - generic [ref=e55]:
              - generic [ref=e56]: Workspace state
              - combobox "Workspace state" [ref=e57]:
                - option "All" [selected]
                - option "No workspace"
                - option "Workspace active"
          - generic [ref=e58]:
            - generic [ref=e59]: Rows
            - combobox "Rows" [ref=e60]:
              - option "10"
              - option "25" [selected]
              - option "50"
              - option "100"
        - table [ref=e62]:
          - rowgroup [ref=e63]:
            - row [ref=e64]:
              - columnheader [ref=e65]:
                - button "Actor" [ref=e66] [cursor=pointer]
              - columnheader [ref=e67]:
                - button "Session" [ref=e68] [cursor=pointer]
              - columnheader [ref=e69]:
                - button "Workspace" [ref=e70] [cursor=pointer]
              - columnheader [ref=e71]:
                - button "Workspace state" [ref=e72] [cursor=pointer]
              - columnheader [ref=e73]:
                - button "Last activity" [ref=e74] [cursor=pointer]
              - columnheader [ref=e75]
          - rowgroup [ref=e76]:
            - row [ref=e77]:
              - cell "ChatGPT" [ref=e78]
              - cell "session-chatgpt" [ref=e79]
              - cell "ws-1" [ref=e80]
              - cell "Workspace active" [ref=e81]
              - cell [ref=e82]
              - cell [ref=e83]:
                - generic [ref=e84]:
                  - button "Switch" [ref=e85] [cursor=pointer]
                  - button "Revoke" [ref=e86] [cursor=pointer]
            - row [ref=e87]:
              - cell "Claude" [ref=e88]
              - cell "session-claude" [ref=e89]
              - cell [ref=e90]
              - cell "No workspace" [ref=e91]
              - cell [ref=e92]
              - cell [ref=e93]:
                - generic [ref=e94]:
                  - button "Switch" [ref=e95] [cursor=pointer]
                  - button "Revoke" [ref=e96] [cursor=pointer]
        - generic [ref=e97]:
          - generic [ref=e98]: 1–2 of 2
          - generic [ref=e99]:
            - button "«" [disabled] [ref=e100]
            - button "‹" [disabled] [ref=e101]
            - generic [ref=e102]: Page 1 / 1
            - button "›" [disabled] [ref=e103]
            - button "»" [disabled] [ref=e104]
    - generic [ref=e105]:
      - heading "Local admin sessions" [level=3] [ref=e107]
      - generic [ref=e108]:
        - generic [ref=e109]:
          - generic [ref=e110]:
            - generic [ref=e111]: Search
            - searchbox "Search" [ref=e112]
          - generic [ref=e113]:
            - generic [ref=e114]: Rows
            - combobox "Rows" [ref=e115]:
              - option "10"
              - option "25" [selected]
              - option "50"
              - option "100"
        - table [ref=e117]:
          - rowgroup [ref=e118]:
            - row [ref=e119]:
              - columnheader [ref=e120]:
                - button "Session hash" [ref=e121] [cursor=pointer]
              - columnheader [ref=e122]:
                - button "Created" [ref=e123] [cursor=pointer]
              - columnheader [ref=e124]:
                - button "Last used" [ref=e125] [cursor=pointer]
              - columnheader [ref=e126]
          - rowgroup [ref=e127]:
            - row [ref=e128]:
              - cell "No data" [ref=e129]
        - generic [ref=e130]:
          - generic [ref=e131]: 0 rows
          - generic [ref=e132]:
            - button "«" [disabled] [ref=e133]
            - button "‹" [disabled] [ref=e134]
            - generic [ref=e135]: Page 1 / 1
            - button "›" [disabled] [ref=e136]
            - button "»" [disabled] [ref=e137]
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
  33 |     await expect(page.getByText('actor-29')).toBeVisible();
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
> 47 |     await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
     |                                                                   ^ Error: expect(locator).toBeVisible() failed
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