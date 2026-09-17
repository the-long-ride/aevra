import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { after } from 'node:test';
import { chromium } from '@playwright/test';
import { runDriverConformance } from './conformance.js';
import { CdpDriver } from '../src/cdp-driver.js';

const PAGE = `<!doctype html><title>Invoices</title><body>
<h1>Invoices</h1>
<button id="new">New invoice</button>
<input type="text" aria-label="Search">
<input type="password" name="password" aria-label="Password">
</body>`;

let server: Server | undefined;
let browser: ChildProcess | undefined;
let startUrl = '';
const port = 47921;

async function ensureFixtures(): Promise<void> {
  if (startUrl) return;
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  startUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  browser = spawn(
    chromium.executablePath(),
    [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', 'about:blank'],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (probe.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chromium did not expose a CDP endpoint');
}

runDriverConformance('CdpDriver', async () => {
  await ensureFixtures();
  const driver = new CdpDriver();
  return {
    driver,
    connectOptions: { transport: 'cdp', cdpPort: port },
    startUrl,
    buttonName: 'New invoice',
    textFieldRole: 'textbox',
    scopedSelector: 'h1',
    scopedExpectation: /Invoices/,
    teardown: async () => {
      await driver.disconnect();
    },
  };
});

// The spawned browser and the fixture server both hold the event loop open, so
// the run has to close them explicitly or `node --test` never exits.
after(async () => {
  browser?.kill();
  browser = undefined;
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = undefined;
});
