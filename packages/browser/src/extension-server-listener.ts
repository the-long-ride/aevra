import { createServer, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptKey } from './ws-server.js';

const LOOPBACK = '127.0.0.1';

export async function startExtensionListener(
  port: number,
  attach: (socket: Duplex, originExtensionId: string) => void,
): Promise<{ server: Server; host: string; port: number; url: string }> {
  // A plain request is the extension asking whether anything listens before
  // it dials: Chrome logs a refused WebSocket as an uncatchable extension
  // error. 426 with no body says only that this is a WebSocket endpoint.
  const server = createServer((_request, response) => {
    response.writeHead(426, { Upgrade: 'websocket', Connection: 'close' });
    response.end();
  });
  server.on('upgrade', (request, socket: Duplex) => {
    const origin = String(request.headers.origin ?? '');
    const originExtensionId = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1];
    if (!originExtensionId) {
      socket.destroy();
      return;
    }
    const key = String(request.headers['sec-websocket-key'] ?? '');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        '\r\n',
      ].join('\r\n'),
    );
    attach(socket, originExtensionId);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { server, host: LOOPBACK, port: actualPort, url: `ws://${LOOPBACK}:${actualPort}` };
}
