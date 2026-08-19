# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> React moves completed onboarding to the bottom and preserves collapse through polling
- Location: tests\ui-parity\dashboard.spec.ts:26:3

# Error details

```
Error: locator.click: Error: strict mode violation: locator('[data-dashboard-section="onboarding"]').locator('summary') resolved to 2 elements:
    1) <summary class="dashboard-section-summary">…</summary> aka getByText('Onboarding⌄')
    2) <summary>Advanced: Cloudflare Access</summary> aka getByText('Advanced: Cloudflare Access')

Call log:
  - waiting for locator('[data-dashboard-section="onboarding"]').locator('summary')

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
    - generic [ref=e39]:
      - heading "Dashboard" [level=2] [ref=e40]
      - paragraph [ref=e41]: Local gateway runtime, connections, requests, and onboarding.
    - group [ref=e42]:
      - generic "[-] Runtime overview" [ref=e43] [cursor=pointer]
      - generic [ref=e46]:
        - generic [ref=e47]:
          - generic [ref=e48]: Remote sessions
          - strong [ref=e49]: "1"
        - generic [ref=e50]:
          - generic [ref=e51]: Workspace leases
          - strong [ref=e52]: "1"
        - generic [ref=e53]:
          - generic [ref=e54]: Pending requests
          - strong [ref=e55]: "0"
        - generic [ref=e56]:
          - generic [ref=e57]: Managed processes
          - strong [ref=e58]: "1"
        - generic [ref=e59]:
          - generic [ref=e60]: Open changes
          - strong [ref=e61]: "1"
        - generic [ref=e62]:
          - generic [ref=e63]: Tool calls
          - strong [ref=e64]: "4"
        - generic [ref=e65]:
          - generic [ref=e66]: Connectors
          - strong [ref=e67]: "1"
    - group [ref=e68]:
      - generic "[-] Active connections" [ref=e69] [cursor=pointer]
      - generic [ref=e72]:
        - generic [ref=e73]:
          - generic [ref=e74]:
            - generic [ref=e75]: Search
            - searchbox "Search" [ref=e76]
          - generic [ref=e77]:
            - generic [ref=e78]:
              - generic [ref=e79]: Auth
              - combobox "Auth" [ref=e80]:
                - option "All" [selected]
                - option "OAuth"
            - generic [ref=e81]:
              - generic [ref=e82]: Status
              - combobox "Status" [ref=e83]:
                - option "All" [selected]
                - option "active"
          - generic [ref=e84]:
            - generic [ref=e85]: Rows
            - combobox "Rows" [ref=e86]:
              - option "10" [selected]
              - option "25"
              - option "50"
              - option "100"
        - table [ref=e88]:
          - rowgroup [ref=e89]:
            - row [ref=e90]:
              - columnheader [ref=e91]:
                - button "Client" [ref=e92] [cursor=pointer]
              - columnheader [ref=e93]:
                - button "Auth" [ref=e94] [cursor=pointer]
              - columnheader [ref=e95]:
                - button "Workspace" [ref=e96] [cursor=pointer]
              - columnheader [ref=e97]:
                - button "Capabilities" [ref=e98] [cursor=pointer]
              - columnheader [ref=e99]:
                - button "Last activity" [ref=e100] [cursor=pointer]
          - rowgroup [ref=e101]:
            - row [ref=e102]:
              - cell "ChatGPT" [ref=e103]
              - cell "OAuth" [ref=e104]
              - cell "Aevra" [ref=e105]
              - cell "files.read" [ref=e106]
              - cell "2026-08-19T00:00:00Z" [ref=e107]
        - generic [ref=e108]:
          - generic [ref=e109]: 1–1 of 1
          - generic [ref=e110]:
            - button "«" [disabled] [ref=e111]
            - button "‹" [disabled] [ref=e112]
            - generic [ref=e113]: Page 1 / 1
            - button "›" [disabled] [ref=e114]
            - button "»" [disabled] [ref=e115]
    - group [ref=e116]:
      - generic "[-] Tool activity" [ref=e117] [cursor=pointer]
      - generic [ref=e120]:
        - generic [ref=e121]:
          - generic [ref=e122]:
            - generic [ref=e123]: Search
            - searchbox "Search" [ref=e124]
          - generic [ref=e125]:
            - generic [ref=e126]: Rows
            - combobox "Rows" [ref=e127]:
              - option "10"
              - option "25" [selected]
              - option "50"
              - option "100"
        - table [ref=e129]:
          - rowgroup [ref=e130]:
            - row [ref=e131]:
              - columnheader [ref=e132]:
                - button "Tool" [ref=e133] [cursor=pointer]
              - columnheader [ref=e134]:
                - button "Calls" [ref=e135] [cursor=pointer]
              - columnheader [ref=e136]:
                - button "Avg latency" [ref=e137] [cursor=pointer]
              - columnheader [ref=e138]:
                - button "Total time" [ref=e139] [cursor=pointer]
          - rowgroup [ref=e140]:
            - row [ref=e141]:
              - cell "file_read" [ref=e142]
              - cell "4" [ref=e143]
              - cell "12" [ref=e144]
              - cell "48" [ref=e145]
        - generic [ref=e146]:
          - generic [ref=e147]: 1–1 of 1
          - generic [ref=e148]:
            - button "«" [disabled] [ref=e149]
            - button "‹" [disabled] [ref=e150]
            - generic [ref=e151]: Page 1 / 1
            - button "›" [disabled] [ref=e152]
            - button "»" [disabled] [ref=e153]
    - group [ref=e154]:
      - generic "[-] Connections" [ref=e155] [cursor=pointer]
      - generic [ref=e157]:
        - generic [ref=e158]:
          - paragraph [ref=e159]: OAuth is recommended. Static Bearer connectors remain available when needed.
          - button "New connector" [ref=e160] [cursor=pointer]
        - generic [ref=e161]:
          - generic [ref=e162]:
            - generic [ref=e163]:
              - generic [ref=e164]: Search
              - searchbox "Search" [ref=e165]
            - generic [ref=e166]:
              - generic [ref=e167]: Rows
              - combobox "Rows" [ref=e168]:
                - option "10"
                - option "25" [selected]
                - option "50"
                - option "100"
          - table [ref=e170]:
            - rowgroup [ref=e171]:
              - row [ref=e172]:
                - columnheader [ref=e173]:
                  - button "Connector" [ref=e174] [cursor=pointer]
                - columnheader [ref=e175]:
                  - button "Created" [ref=e176] [cursor=pointer]
                - columnheader [ref=e177]:
                  - button "Last used" [ref=e178] [cursor=pointer]
                - columnheader [ref=e179]
            - rowgroup [ref=e180]:
              - row [ref=e181]:
                - cell "Static client" [ref=e182]
                - cell "2026-08-19T00:00:00Z" [ref=e183]
                - cell "2026-08-19T00:00:00Z" [ref=e184]
                - cell [ref=e185]:
                  - button "Revoke" [ref=e186] [cursor=pointer]
          - generic [ref=e187]:
            - generic [ref=e188]: 1–1 of 1
            - generic [ref=e189]:
              - button "«" [disabled] [ref=e190]
              - button "‹" [disabled] [ref=e191]
              - generic [ref=e192]: Page 1 / 1
              - button "›" [disabled] [ref=e193]
              - button "»" [disabled] [ref=e194]
    - group [ref=e195]:
      - generic "[-] Recent activity" [ref=e196] [cursor=pointer]
      - generic [ref=e199]:
        - generic [ref=e200]:
          - generic [ref=e201]: Requests
          - strong [ref=e202]: "0"
        - generic [ref=e203]:
          - generic [ref=e204]: Sessions
          - strong [ref=e205]: "1"
        - generic [ref=e206]:
          - generic [ref=e207]: Processes
          - strong [ref=e208]: "1"
        - generic [ref=e209]:
          - generic [ref=e210]: Changes
          - strong [ref=e211]: "1"
    - group [ref=e212]:
      - generic "[-] Onboarding" [ref=e213] [cursor=pointer]
      - generic [ref=e216]:
        - generic [ref=e217]:
          - generic [ref=e218]:
            - generic [ref=e219]: Remote Access
            - strong [ref=e220]: Configured
          - generic [ref=e221]:
            - generic [ref=e222]:
              - generic [ref=e223]:
                - generic [ref=e224]:
                  - generic [ref=e225]: cloudflared
                  - paragraph [ref=e226]: Detected · Authentication has not been checked.
                - generic [ref=e227]: Authenticated
              - button "Check authentication" [ref=e228] [cursor=pointer]
            - generic [ref=e229]:
              - generic [ref=e230]: Canonical MCP endpoint
              - code [ref=e231]: https://aevra.example.com/mcp
              - button "Copy" [ref=e232] [cursor=pointer]
            - generic [ref=e233]:
              - generic [ref=e234]:
                - generic [ref=e235]:
                  - generic [ref=e236]: Public MCP hostname
                  - textbox "Public MCP hostname" [ref=e237]: aevra.example.com
                - generic [ref=e238]:
                  - generic [ref=e239]: Tunnel ID
                  - textbox "Tunnel ID" [ref=e240]: tunnel-1
                - generic [ref=e241]:
                  - generic [ref=e242]: Tunnel ownership
                  - combobox "Tunnel ownership" [ref=e243]:
                    - option "Managed by Aevra" [selected]
                    - option "External process"
              - generic [ref=e244]:
                - paragraph
                - generic [ref=e245]:
                  - button "Test endpoint" [ref=e246] [cursor=pointer]
                  - button "Save remote access" [ref=e247] [cursor=pointer]
            - group [ref=e248]:
              - 'generic "Advanced: Cloudflare Access" [ref=e249]'
        - generic [ref=e250]:
          - generic [ref=e251]:
            - generic [ref=e252]: Connect an AI
            - strong [ref=e253]: Example guide
          - paragraph [ref=e254]: Examples only; provider screens can change.
          - generic [ref=e255]:
            - generic [ref=e256]: MCP endpoint
            - code [ref=e257]: https://aevra.example.com/mcp
          - generic [ref=e258]:
            - article [ref=e259]:
              - heading "ChatGPT" [level=3] [ref=e260]
              - paragraph [ref=e261]: Create a custom MCP app and use OAuth.
              - paragraph [ref=e262]: "Authentication: OAuth"
            - article [ref=e263]:
              - heading "Claude" [level=3] [ref=e264]
              - paragraph [ref=e265]: Add a remote MCP server and authenticate with OAuth.
              - paragraph [ref=e266]: "Authentication: OAuth"
            - article [ref=e267]:
              - heading "Gemini" [level=3] [ref=e268]
              - paragraph [ref=e269]: Add the MCP endpoint and complete OAuth.
              - paragraph [ref=e270]: "Authentication: OAuth"
        - generic [ref=e271]:
          - generic [ref=e272]:
            - generic [ref=e273]: Workspace
            - strong [ref=e274]: 1 registered
          - paragraph [ref=e275]: Your local workspace is ready. Manage details from Workspaces.
        - generic [ref=e276]:
          - generic [ref=e277]:
            - generic [ref=e278]: Try Aevra
            - strong [ref=e279]: Start read-only
          - paragraph [ref=e280]: Select a workspace from chat, approve access locally, then start with status, skills and file reads.
        - generic [ref=e281]:
          - generic [ref=e282]: Onboarding completed
          - button "Completed" [disabled] [ref=e283]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { ADMIN_SURFACES, installAdminApi } from './fixtures';
  3  | 
  4  | for (const surface of ADMIN_SURFACES) {
  5  |   test(`${surface.name} keeps dashboard section and collapse behavior`, async ({ page }) => {
  6  |     await installAdminApi(page);
  7  |     await page.goto(surface.path);
  8  |     await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  9  | 
  10 |     const onboardingBlocks = page.locator(
  11 |       '[data-dashboard-section="onboarding"] [data-onboarding-section]',
  12 |     );
  13 |     await expect(onboardingBlocks.first()).toHaveAttribute(
  14 |       'data-onboarding-section',
  15 |       'remote-access',
  16 |     );
  17 | 
  18 |     const runtime = page.locator('[data-dashboard-section="runtime-overview"]');
  19 |     await expect(runtime).toHaveAttribute('open', '');
  20 |     await expect(runtime.getByText('Remote sessions')).toBeVisible();
  21 |     await expect(runtime.getByText('Version', { exact: true })).toHaveCount(0);
  22 |     await runtime.locator('summary').click();
  23 |     await expect(runtime).not.toHaveAttribute('open', '');
  24 |   });
  25 | 
  26 |   test(`${surface.name} moves completed onboarding to the bottom and preserves collapse through polling`, async ({
  27 |     page,
  28 |   }) => {
  29 |     await installAdminApi(page, { onboardingCompleted: true });
  30 |     await page.goto(surface.path);
  31 |     await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  32 | 
  33 |     const sections = page.locator('[data-dashboard-section]');
  34 |     const ids = await sections.evaluateAll((nodes) =>
  35 |       nodes.map((node) => node.getAttribute('data-dashboard-section')),
  36 |     );
  37 |     expect(ids.at(-1)).toBe('onboarding');
  38 | 
  39 |     const onboarding = page.locator('[data-dashboard-section="onboarding"]');
> 40 |     await onboarding.locator('summary').click();
     |                                         ^ Error: locator.click: Error: strict mode violation: locator('[data-dashboard-section="onboarding"]').locator('summary') resolved to 2 elements:
  41 |     await expect(onboarding).not.toHaveAttribute('open', '');
  42 |     await page.waitForTimeout(2200);
  43 |     await expect(onboarding).not.toHaveAttribute('open', '');
  44 |   });
  45 | }
  46 | 
```