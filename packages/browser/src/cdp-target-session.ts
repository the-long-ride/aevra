import { BrowserDriverError } from './driver.js';
import { CdpClient } from './cdp-client.js';

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpTargetState {
  id: string;
  client: CdpClient;
  version: number;
  backendIds: number[];
  credentialRefs: Set<string>;
}

async function createState(target: CdpTarget): Promise<CdpTargetState> {
  if (!target.webSocketDebuggerUrl) {
    throw new BrowserDriverError(
      'BROWSER_UNAVAILABLE',
      'Target ' + target.id + ' has no debugger websocket',
    );
  }
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Accessibility.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  return {
    id: target.id,
    client,
    version: 0,
    backendIds: [],
    credentialRefs: new Set<string>(),
  };
}

export class CdpTargetSessionRegistry {
  private readonly states = new Map<string, CdpTargetState>();
  private defaultTargetId = '';

  constructor(private readonly targets: () => Promise<CdpTarget[]>) {}

  activeId(): string {
    return this.defaultTargetId;
  }

  setActive(targetId: string): void {
    this.defaultTargetId = targetId;
  }

  async connectInitial(targetId?: string): Promise<CdpTargetState> {
    const pages = (await this.targets()).filter((target) => target.type === 'page');
    const target = targetId ? pages.find((candidate) => candidate.id === targetId) : pages[0];
    if (!target) {
      throw new BrowserDriverError('BROWSER_UNAVAILABLE', 'No debuggable page target was found');
    }
    const state = await createState(target);
    this.states.set(target.id, state);
    this.defaultTargetId = target.id;
    return state;
  }

  async target(targetId?: string): Promise<CdpTargetState> {
    const id = targetId || this.defaultTargetId;
    if (!id) {
      throw new BrowserDriverError('BROWSER_NOT_CONNECTED', 'No CDP target is selected');
    }
    const existing = this.states.get(id);
    if (existing) return existing;
    const target = (await this.targets()).find(
      (candidate) => candidate.type === 'page' && candidate.id === id,
    );
    if (!target) {
      throw new BrowserDriverError('NOT_FOUND', 'Browser target ' + id + ' no longer exists');
    }
    const state = await createState(target);
    this.states.set(id, state);
    return state;
  }

  async closeTarget(targetId: string): Promise<void> {
    const state = this.states.get(targetId);
    this.states.delete(targetId);
    if (state) await state.client.close();
    if (this.defaultTargetId === targetId) this.defaultTargetId = '';
  }

  async closeAll(): Promise<void> {
    const states = [...this.states.values()];
    this.states.clear();
    this.defaultTargetId = '';
    await Promise.allSettled(states.map((state) => state.client.close()));
  }
}
