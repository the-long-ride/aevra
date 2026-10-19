export interface ListenerPortOptions {
  basePort?: number;
  gatewayPort?: number;
  uiPort?: number;
  mcpPort?: number;
  wsPort?: number;
}

export function validatePortOptions(options: ListenerPortOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${name} must be an integer port from 1 to 65535`);
    }
  }
  if (options.basePort !== undefined) {
    if (Object.keys(options).some((key) => key !== 'basePort')) {
      throw new Error('Cannot mix --basePort with individual port options');
    }
    if (options.basePort > 65532) {
      throw new Error('--basePort must be 1..65532 so all four ports fit');
    }
  }
}

export function resolveListenerPorts(env: NodeJS.ProcessEnv, options: ListenerPortOptions = {}) {
  validatePortOptions(options);
  const base = options.basePort;
  const read = (key: string, fallback: number, override: number | undefined) => {
    if (override !== undefined) return override;
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`${key} must be 1..65535`);
    }
    return value;
  };
  const ports = {
    publicPort: read('AEVRA_PUBLIC_PORT', 47830, base ?? options.gatewayPort),
    adminPort: read('AEVRA_ADMIN_PORT', 47831, base === undefined ? options.uiPort : base + 1),
    mcpPort: read('AEVRA_MCP_PORT', 47832, base === undefined ? options.mcpPort : base + 2),
    browserPort: read('AEVRA_BROWSER_PORT', 47833, base === undefined ? options.wsPort : base + 3),
  };
  if (new Set(Object.values(ports)).size !== 4) {
    throw new Error('Gateway, UI, MCP and WebSocket listener ports must be distinct');
  }
  return ports;
}
