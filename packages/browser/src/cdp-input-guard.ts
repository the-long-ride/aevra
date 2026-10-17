import type { CdpClient } from './cdp-client.js';

/** Recheck document authority after selector/focus waits and before every native event. */
export function guardedInputClient(client: CdpClient, check: () => Promise<void>): CdpClient {
  return new Proxy(client, {
    get(target, key) {
      if (key === 'send')
        return async (method: string, params?: Record<string, unknown>) => {
          if (method.startsWith('Input.') || method === 'DOM.focus') await check();
          return target.send(method, params);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
