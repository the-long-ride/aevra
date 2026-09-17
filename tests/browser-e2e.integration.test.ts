import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { CdpDriver } from '../packages/browser/src/cdp-driver.js';

const PAGE = `<!doctype html><title>Aevra e2e</title>
<button id="go">Run report</button>
<input id="q" aria-label="Query" />
<input id="secret" type="password" aria-label="Password" />
<p id="out">idle</p>
<script>
  document.getElementById('go').addEventListener('click', () => {
    document.getElementById('out').textContent = 'ran:' + document.getElementById('q').value;
  });
</script>`;

test('a real Chromium completes a multi-step task through the CDP driver', async (t) => {
  const site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const sitePort = (site.address() as { port: number }).port;

  const profile = mkdtempSync(path.join(os.tmpdir(), 'aevra-e2e-'));
  const linuxArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const child = spawn(
    chromium.executablePath(),
    [
      ...linuxArgs,
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  // Port 0 lets the OS choose; Chromium prints the resolved endpoint on stderr.
  const cdpPort = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Chromium did not report a debug port')),
      20_000,
    );
    child.stderr!.on('data', (chunk) => {
      const match = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });

  t.after(async () => {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await new Promise<void>((resolve) => site.close(() => resolve()));
    // Windows keeps the profile locked for a moment after the browser exits. A
    // leftover temp directory is not worth failing an otherwise passing run.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* the OS reclaims it */
    }
  });

  // Chromium prints its debug endpoint before a page target is necessarily
  // listed, so wait for one rather than racing the first /json/list.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const listed = (await (
        await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      ).json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      if (listed.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch {
      /* endpoint not serving yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const driver = new CdpDriver();
  await driver.connect({ transport: 'cdp', cdpPort });
  try {
    await driver.navigate({ url: `http://127.0.0.1:${sitePort}/`, waitUntil: 'load' });

    const snapshot = await driver.snapshot({ mode: 'a11y', maxNodes: 200 });
    const query = snapshot.nodes?.find((node) => node.name === 'Query');
    const button = snapshot.nodes?.find((node) => node.name === 'Run report');
    const password = snapshot.nodes?.find((node) => node.credentialField === true);
    assert.ok(query && button && password);

    const typed = await driver.act([{ op: 'type', ref: query!.ref, text: 'quarterly' }], {
      stopOnError: true,
    });
    assert.equal(typed[0]!.ok, true);

    const clicked = await driver.act([{ op: 'click', ref: button!.ref }], { stopOnError: true });
    assert.equal(clicked[0]!.ok, true);

    const read = await driver.read({ selector: '#out', format: 'text' });
    assert.match(read.content, /ran:quarterly/);

    const refused = await driver.act([{ op: 'type', ref: password!.ref, text: 'anything' }], {
      stopOnError: true,
    });
    assert.equal(refused[0]!.error?.code, 'BROWSER_CREDENTIAL_FIELD_REFUSED');

    const shot = await driver.snapshot({ mode: 'vision', maxNodes: 200 });
    assert.ok(String(shot.imageDataUri).startsWith('data:image/'));

    // Action kinds the conformance suite does not reach, against a real page.
    const keyed = await driver.act([{ op: 'press_key', key: 'Enter' }], { stopOnError: true });
    assert.equal(keyed[0]!.ok, true);

    const scrolled = await driver.act([{ op: 'scroll', x: 5, y: 5, dx: 0, dy: 40 }], {
      stopOnError: true,
    });
    assert.equal(scrolled[0]!.ok, true);

    const waited = await driver.act([{ op: 'wait_for', text: 'ran:quarterly', timeoutMs: 2000 }], {
      stopOnError: true,
    });
    assert.equal(waited[0]!.ok, true);

    const timedOut = await driver.act(
      [{ op: 'wait_for', text: 'never appears on this page', timeoutMs: 300 }],
      { stopOnError: false },
    );
    assert.equal(timedOut[0]!.error?.code, 'BROWSER_TIMEOUT');
  } finally {
    await driver.disconnect();
  }
});
