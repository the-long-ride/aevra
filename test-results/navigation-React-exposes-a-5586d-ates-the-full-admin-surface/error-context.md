# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> React exposes and navigates the full admin surface
- Location: tests\ui-parity\navigation.spec.ts:5:3

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
            - generic [ref=e55]:
              - generic [ref=e56]: Workspace state
              - combobox "Workspace state" [ref=e57]:
                - option "All" [selected]
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
              - cell "No data" [ref=e78]
        - generic [ref=e79]:
          - generic [ref=e80]: 0 rows
          - generic [ref=e81]:
            - button "«" [disabled] [ref=e82]
            - button "‹" [disabled] [ref=e83]
            - generic [ref=e84]: Page 1 / 1
            - button "›" [disabled] [ref=e85]
            - button "»" [disabled] [ref=e86]
    - generic [ref=e87]:
      - heading "Local admin sessions" [level=3] [ref=e89]
      - generic [ref=e90]:
        - generic [ref=e91]:
          - generic [ref=e92]:
            - generic [ref=e93]: Search
            - searchbox "Search" [ref=e94]
          - generic [ref=e95]:
            - generic [ref=e96]: Rows
            - combobox "Rows" [ref=e97]:
              - option "10"
              - option "25" [selected]
              - option "50"
              - option "100"
        - table [ref=e99]:
          - rowgroup [ref=e100]:
            - row [ref=e101]:
              - columnheader [ref=e102]:
                - button "Session hash" [ref=e103] [cursor=pointer]
              - columnheader [ref=e104]:
                - button "Created" [ref=e105] [cursor=pointer]
              - columnheader [ref=e106]:
                - button "Last used" [ref=e107] [cursor=pointer]
              - columnheader [ref=e108]
          - rowgroup [ref=e109]:
            - row [ref=e110]:
              - cell "No data" [ref=e111]
        - generic [ref=e112]:
          - generic [ref=e113]: 0 rows
          - generic [ref=e114]:
            - button "«" [disabled] [ref=e115]
            - button "‹" [disabled] [ref=e116]
            - generic [ref=e117]: Page 1 / 1
            - button "›" [disabled] [ref=e118]
            - button "»" [disabled] [ref=e119]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { ADMIN_SURFACES, installAdminApi } from './fixtures';
  3  | 
  4  | for (const surface of ADMIN_SURFACES) {
  5  |   test(`${surface.name} exposes and navigates the full admin surface`, async ({ page }) => {
  6  |     await installAdminApi(page);
  7  |     await page.goto(surface.path);
  8  |     await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  9  | 
  10 |     for (const destination of [
  11 |       'Workspaces',
  12 |       'Permissions',
  13 |       'Sessions',
  14 |       'Processes',
  15 |       'Changes',
  16 |       'Audit',
  17 |       'Settings',
  18 |       'Guide',
  19 |       'Dashboard',
  20 |     ]) {
  21 |       await page.getByRole('button', { name: destination, exact: true }).click();
> 22 |       await expect(page.getByRole('heading', { name: destination })).toBeVisible();
     |                                                                      ^ Error: expect(locator).toBeVisible() failed
  23 |     }
  24 | 
  25 |     await page.getByRole('button', { name: 'Settings', exact: true }).click();
  26 |     await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  27 |     await page.getByRole('button', { name: 'Guide', exact: true }).click();
  28 |     await expect(page.getByRole('heading', { name: 'Guide' })).toBeVisible();
  29 |     await page.goBack();
  30 |     await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  31 |   });
  32 | }
  33 | 
  34 | test('slow Dashboard work cannot switch the user back after a fast tab change', async ({
  35 |   page,
  36 | }) => {
  37 |   await installAdminApi(page, { dashboardDelayMs: 1000 });
  38 |   await page.goto('/#/settings');
  39 |   await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  40 | 
  41 |   await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  42 |   await page.getByRole('button', { name: 'Guide', exact: true }).click();
  43 |   await expect(page.getByRole('heading', { name: 'Guide' })).toBeVisible();
  44 |   await page.waitForTimeout(1300);
  45 | 
  46 |   await expect(page.getByRole('heading', { name: 'Guide' })).toBeVisible();
  47 |   await expect(page).toHaveURL(/#\/guide$/);
  48 | });
  49 | 
```