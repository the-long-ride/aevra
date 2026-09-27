export interface FakeTab {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  active?: boolean;
  width?: number;
  height?: number;
}

export function installChrome(tabs: FakeTab[], overrides: Record<string, any> = {}) {
  const listeners: Array<(id: number, info: { status?: string }) => void> = [];
  const calls: Record<string, any[]> = {
    executeScript: [],
    update: [],
    capture: [],
    focusWindow: [],
    debugger: [],
  };
  let focusedWindowId = tabs.find((tab) => tab.active)?.windowId;
  const chrome = {
    tabs: {
      async query(filter: { active?: boolean; lastFocusedWindow?: boolean }) {
        return tabs.filter(
          (tab) =>
            (!filter?.active || tab.active) &&
            (!filter?.lastFocusedWindow || tab.windowId === focusedWindowId),
        );
      },
      async get(id: number) {
        const tab = tabs.find((entry) => entry.id === id);
        return tab ? { ...tab, url: tab.url ?? 'https://example.test/' } : {};
      },
      async update(id: number, props: Record<string, unknown>) {
        calls.update!.push([id, props]);
        const tab = tabs.find((entry) => entry.id === id);
        if (tab && typeof props.url === 'string') tab.url = props.url;
        if (tab && props.active === true) {
          for (const entry of tabs) {
            if (entry.windowId === tab.windowId) entry.active = false;
          }
          tab.active = true;
        }
        return tab;
      },
      async captureVisibleTab(_window: unknown, options: unknown) {
        calls.capture!.push(options);
        return 'data:image/jpeg;base64,AAAA';
      },
      onUpdated: {
        addListener(fn: (id: number, info: { status?: string }) => void) {
          listeners.push(fn);
        },
        removeListener(fn: (id: number, info: { status?: string }) => void) {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        },
      },
      ...overrides.tabs,
    },
    scripting: {
      async executeScript(input: Record<string, unknown>) {
        calls.executeScript!.push(input);
        return [{ result: 'injected' in overrides ? overrides.injected : { ok: true } }];
      },
    },
    windows: {
      async update(id: number, props: Record<string, unknown>) {
        calls.focusWindow!.push([id, props]);
        if (props.focused === true) focusedWindowId = id;
      },
    },
    debugger: {
      async attach(target: unknown, version: string) {
        calls.debugger!.push(['attach', target, version]);
        await overrides.debugger?.attach?.(target, version);
      },
      async sendCommand(target: unknown, method: string, params: unknown) {
        calls.debugger!.push(['send', target, method, params]);
        await overrides.debugger?.sendCommand?.(target, method, params);
      },
      async detach(target: unknown) {
        calls.debugger!.push(['detach', target]);
        await overrides.debugger?.detach?.(target);
      },
    },
  };
  (globalThis as any).chrome = chrome;
  return {
    calls,
    complete: (id: number) => listeners.forEach((fn) => fn(id, { status: 'complete' })),
    listenerCount: () => listeners.length,
  };
}
