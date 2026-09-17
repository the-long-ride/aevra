import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserDriver, ConnectOptions } from '../src/driver.js';

export interface ConformanceHarness {
  driver: BrowserDriver;
  connectOptions: ConnectOptions;
  startUrl: string;
  buttonName: string;
  textFieldRole: string;
  /** A selector naming one element, used to prove a scoped read is scoped. */
  scopedSelector: string;
  scopedExpectation: RegExp;
  teardown: () => Promise<void>;
}

export function runDriverConformance(
  label: string,
  createHarness: () => Promise<ConformanceHarness>,
): void {
  test(`${label}: connect reports its own transport and at least one tab`, async () => {
    const harness = await createHarness();
    try {
      const session = await harness.driver.connect(harness.connectOptions);
      assert.equal(session.transport, harness.driver.transport);
      assert.equal(session.connected, true);
      assert.ok(session.tabs.length >= 1);
      assert.ok(session.tabs.every((tab) => typeof tab.originClass === 'string'));
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: navigate then snapshot yields addressable refs`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      const navigated = await harness.driver.navigate({
        url: harness.startUrl,
        waitUntil: 'load',
      });
      assert.ok(navigated.url.startsWith('http'));
      const snapshot = await harness.driver.snapshot({ mode: 'a11y', maxNodes: 100 });
      const button = snapshot.nodes?.find((node) => node.name === harness.buttonName);
      assert.ok(button, 'expected the button to appear in the a11y snapshot');
      assert.match(button.ref, /^ref_\d+_\d+$/);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: vision snapshot returns an image and boxes`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const snapshot = await harness.driver.snapshot({ mode: 'vision', maxNodes: 100 });
      assert.match(String(snapshot.imageDataUri), /^data:image\/(png|jpeg);base64,/);
      assert.ok(Array.isArray(snapshot.boxes));
      // Boxes and coordinates share the screenshot's pixel space, so a driver
      // that captures at device scale has to say so. A missing or zero ratio
      // leaves the caller unable to reconcile the image with the boxes.
      assert.equal(typeof snapshot.devicePixelRatio, 'number');
      assert.ok(snapshot.devicePixelRatio! > 0);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: act by ref clicks, act by coordinate clicks`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const snapshot = await harness.driver.snapshot({ mode: 'a11y', maxNodes: 100 });
      const button = snapshot.nodes!.find((node) => node.name === harness.buttonName)!;
      const byRef = await harness.driver.act([{ op: 'click', ref: button.ref }], {
        stopOnError: true,
      });
      assert.equal(byRef[0]!.ok, true);
      const byCoordinate = await harness.driver.act([{ op: 'click', x: 5, y: 5 }], {
        stopOnError: true,
      });
      assert.equal(byCoordinate.length, 1);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: a stale ref fails with BROWSER_REF_STALE rather than acting`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      await harness.driver.snapshot({ mode: 'a11y', maxNodes: 100 });
      const results = await harness.driver.act([{ op: 'click', ref: 'ref_0_0' }], {
        stopOnError: false,
      });
      assert.equal(results[0]!.ok, false);
      assert.equal(results[0]!.error?.code, 'BROWSER_REF_STALE');
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: typing into a credential field is refused`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const snapshot = await harness.driver.snapshot({ mode: 'a11y', maxNodes: 100 });
      const secret = snapshot.nodes!.find((node) => node.credentialField);
      assert.ok(secret, 'fixture page must contain a password field');
      const results = await harness.driver.act([{ op: 'type', ref: secret.ref, text: 'chosen' }], {
        stopOnError: false,
      });
      assert.equal(results[0]!.ok, false);
      assert.equal(results[0]!.error?.code, 'BROWSER_CREDENTIAL_FIELD_REFUSED');
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: read returns page text`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const read = await harness.driver.read({ format: 'text' });
      assert.match(read.content, /Invoices/);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: wait_for succeeds on text already present`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const results = await harness.driver.act(
        [{ op: 'wait_for', text: harness.buttonName, timeoutMs: 2000 }],
        { stopOnError: true },
      );
      assert.equal(results[0]!.ok, true);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: a wait_for longer than the default socket budget is honoured`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      await harness.driver.snapshot({ mode: 'a11y', maxNodes: 100 });
      // 60s is above the 15s per-call budget the extension transport used to
      // apply unconditionally, which made this same call fail there while it
      // succeeded over CDP. The text is already on the page, so it returns at
      // once - what is under test is the budget, not the wait.
      const results = await harness.driver.act(
        [{ op: 'wait_for', text: harness.buttonName, timeoutMs: 60_000 }],
        { stopOnError: true },
      );
      assert.equal(results[0]!.ok, true);
    } finally {
      await harness.teardown();
    }
  });
  test(`${label}: wait_for reports BROWSER_TIMEOUT for text that never appears`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const started = Date.now();
      const results = await harness.driver.act(
        [{ op: 'wait_for', text: 'text that is never on this page', timeoutMs: 400 }],
        { stopOnError: false },
      );
      assert.equal(results[0]!.ok, false);
      assert.equal(results[0]!.error?.code, 'BROWSER_TIMEOUT');
      // Pins the behaviour that differed: it must wait, not fail instantly.
      assert.ok(Date.now() - started >= 300, 'wait_for returned before its deadline');
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: read scoped to a selector returns less than the whole page`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.navigate({ url: harness.startUrl, waitUntil: 'load' });
      const whole = await harness.driver.read({ format: 'text' });
      const scoped = await harness.driver.read({
        selector: harness.scopedSelector,
        format: 'text',
      });
      assert.ok(
        scoped.content.length < whole.content.length,
        'a scoped read returned the whole document',
      );
      assert.match(scoped.content, harness.scopedExpectation);
    } finally {
      await harness.teardown();
    }
  });

  test(`${label}: operations after disconnect fail with BROWSER_NOT_CONNECTED`, async () => {
    const harness = await createHarness();
    try {
      await harness.driver.connect(harness.connectOptions);
      await harness.driver.disconnect();
      await assert.rejects(
        () => harness.driver.snapshot({ mode: 'a11y', maxNodes: 10 }),
        /BROWSER_NOT_CONNECTED/,
      );
    } finally {
      await harness.teardown();
    }
  });
}
