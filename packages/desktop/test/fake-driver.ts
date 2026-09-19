import type { DesktopCapabilities } from '../../protocol/src/desktop.js';
import { DesktopDriverError, type ActRequest, type DesktopDriver } from '../src/driver.js';

// Not a real PNG. Nothing in the codebase decodes this value — the only
// assertion anywhere is a prefix/length regex on the data URI — so a
// low-entropy placeholder is deliberately used instead of a real image
// blob, to avoid a secret-shaped (high-entropy base64) literal in a fixture.
// Do not "helpfully" restore a real image here.
const PIXEL = `data:image/png;base64,${'a'.repeat(64)}`;

export class FakeDesktopDriver implements DesktopDriver {
  private refs = new Set<string>();

  constructor(private readonly capabilities: DesktopCapabilities) {}

  async connect() {
    return this.capabilities;
  }

  async windows() {
    return [{ windowId: 'w1', processName: 'notepad.exe', title: 'Untitled' }];
  }

  async focusedWindow() {
    return { windowId: 'w1', processName: 'notepad.exe', title: 'Untitled' };
  }

  async describe() {
    this.refs = new Set(['ref_1_1']);
    return {
      window: await this.focusedWindow(),
      nodes: [{ ref: 'ref_1_1', role: 'button', name: 'Save', enabled: true, focused: false }],
      truncated: false,
    };
  }

  async capture() {
    return { imageDataUri: PIXEL, devicePixelRatio: 1, window: await this.focusedWindow() };
  }

  async act(request: ActRequest) {
    if (request.ref && !this.refs.has(request.ref)) {
      throw new DesktopDriverError('DESKTOP_REF_STALE', `Ref ${request.ref} is no longer live`);
    }
    return { ok: true, delta: { focusChanged: false, newWindow: false, subtreeChanged: true } };
  }

  async disconnect() {
    this.refs.clear();
  }

  async targetIdentity(windowId: string) {
    return {
      window: { windowId, processName: 'notepad.exe', title: 'Untitled' },
      windowInstance: { windowId, processId: 1234, processStartedAt: '2026-09-18T00:00:00Z' },
    };
  }

  async describeBackground(request: {
    windowId: string;
    snapshotId: string;
    maxNodes: number;
    interactiveOnly: boolean;
  }) {
    this.refs = new Set(['ref_1_1']);
    return {
      window: { windowId: request.windowId, processName: 'notepad.exe', title: 'Untitled' },
      windowInstance: { windowId: request.windowId, processId: 1234, processStartedAt: '2026-09-18T00:00:00Z' },
      nodes: [
        {
          ref: 'ref_1_1',
          role: 'button',
          name: 'Save',
          enabled: true,
          focused: false,
          supportedActions: ['invoke' as const],
        },
      ],
      truncated: false,
    };
  }

  async releaseBackgroundSnapshot(_snapshotId: string) {
    return true;
  }

  async backgroundAct(request: {
    snapshotId: string;
    handle: string;
    op: string;
    value?: string;
    expectedInstance: { windowId: string; processId: number; processStartedAt: string };
  }) {
    return {
      ok: true,
      outcome: 'completed',
      focusChanged: false,
    };
  }
}
