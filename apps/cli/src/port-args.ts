import { validatePortOptions, type ListenerPortOptions } from '../../core/src/listener-ports.js';

const PORT_FLAGS: Record<string, keyof ListenerPortOptions> = {
  '--basePort': 'basePort',
  '--gateway-port': 'gatewayPort',
  '--gp': 'gatewayPort',
  '--ui-port': 'uiPort',
  '--up': 'uiPort',
  '--mcp-port': 'mcpPort',
  '--mp': 'mcpPort',
  '--ws-port': 'wsPort',
  '--wp': 'wsPort',
};

/** Extract port options without weakening the caller's other argument checks. */
export function parsePortArgs(args: string[]) {
  const ports: ListenerPortOptions = {};
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const equals = arg.indexOf('=');
    const flag = equals < 0 ? arg : arg.slice(0, equals);
    const key = PORT_FLAGS[flag];
    if (!key) {
      rest.push(arg);
      continue;
    }
    if (Object.hasOwn(ports, key)) throw new Error(`Duplicate port option: ${flag}`);
    const raw = equals < 0 ? args[++index] : arg.slice(equals + 1);
    if (raw === undefined || !/^\d+$/.test(raw)) {
      throw new Error(`${flag} requires an integer port value from 1 to 65535`);
    }
    ports[key] = Number(raw);
  }
  validatePortOptions(ports);
  return { rest, ...(Object.keys(ports).length ? { ports } : {}) };
}

export function portOptionsToArgs(options: ListenerPortOptions = {}): string[] {
  validatePortOptions(options);
  const names: Record<keyof ListenerPortOptions, string> = {
    basePort: '--basePort',
    gatewayPort: '--gateway-port',
    uiPort: '--ui-port',
    mcpPort: '--mcp-port',
    wsPort: '--ws-port',
  };
  return (Object.keys(options) as Array<keyof ListenerPortOptions>).map(
    (key) => `${names[key]}=${options[key]}`,
  );
}
