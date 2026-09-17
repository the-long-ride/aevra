const mode = process.argv[2] ?? 'ok';
let buffer = '';

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (mode === 'noisy') {
  process.stdout.write('fake-stdio-server starting\n');
  process.stderr.write('warning: running in fake mode\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line.trim()) continue;
    const request = JSON.parse(line) as { id?: number; method: string };
    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-stdio', version: '9.9.9' },
        },
      });
      if (mode === 'notify') send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      continue;
    }
    if (request.method === 'notifications/initialized' || mode === 'hang') continue;
    if (request.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object' } }],
        },
      });
      continue;
    }
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `no method ${request.method}` },
    });
  }
});
