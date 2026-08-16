import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import type { CoreConfig } from '../../core/src/config.js';
import { localTlsPaths } from '../../core/src/tls/local-tls.js';

function trustedCa(config: CoreConfig): Buffer | undefined {
  if (config.tlsCaPath) return readFileSync(config.tlsCaPath);
  if (config.tlsCertPath) return undefined;
  const managed = localTlsPaths(config.stateDir).certificatePath;
  return existsSync(managed) ? readFileSync(managed) : undefined;
}

function responseHeaders(headers: import('node:http').IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

export function localAdminBase(config: CoreConfig): string {
  return `https://localhost:${config.adminPort}`;
}

export async function localAdminFetch(
  config: CoreConfig,
  requestPath: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : undefined;
  if (body !== undefined && !headers.has('content-length'))
    headers.set('content-length', String(Buffer.byteLength(body)));
  const ca = trustedCa(config);
  return await new Promise<Response>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'localhost',
        port: config.adminPort,
        path: requestPath,
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        ca,
        rejectUnauthorized: true,
        servername: 'localhost',
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: responseHeaders(response.headers),
            }),
          );
        });
      },
    );
    request.once('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
