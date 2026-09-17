import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { after } from 'node:test';
import os from 'node:os';
import path from 'node:path';
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
let port = 0;
let profile = '';

async function ensureFixtures(): Promise<void> {
  if (startUrl) return;
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  startUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  profile = mkdtempSync(path.join(os.tmpdir(), 'aevra-cdp-'));
  const linuxArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  browser = spawn(
    chromium.executablePath(),
    [
      ...linuxArgs,
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  port = await new Promise<number>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error('Chromium did not report a debug port')),
      20_000,
    );
    browser!.stderr!.on('data', (chunk) => {
      const text = String(chunk);
      stderr = `${stderr}${text}`.slice(-2_000);
      const match = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    browser!.once('exit', () => {
      clearTimeout(timer);
      const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
      reject(new Error(`Chromium exited before reporting a debug port${detail}`));
    });
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const listed = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl?: string;
      }>;
      if (listed.some((target) => target.type === 'page' && target.webSocketDebuggerUrl)) return;
    } catch {
      /* endpoint not serving yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Chromium did not expose a debuggable page target');
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
  if (profile) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* the OS reclaims it */
    }
    profile = '';
  }
});
