import net from 'node:net';

import { egressDecision, systemBrowserResolver } from './browser-egress-policy';
import { BROWSER_EGRESS_HEADER } from './browser-tool.constants';

import type { BrowserEgressOptions, BrowserEgressProxy } from './browser-egress.types';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

const HOP_HEADERS = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive'];

function split(authority: string): { host: string; port: number } | undefined {
  try {
    const url = new URL(`http://${authority}`);
    const port = Number(url.port === '' ? 80 : url.port);
    return url.hostname.length === 0 ? undefined : { host: url.hostname, port };
  } catch {
    return undefined;
  }
}

/**
 * The one door the browser reaches the network through.
 *
 * Chromium is started with this as its proxy (and with loopback no longer
 * exempt), so a page's fetch, WebSocket, worker, iframe or redirect all arrive
 * here as a CONNECT or an absolute-URI request, whatever started them. Each is
 * judged by `egressDecision` and, if it passes, goes to the address that was
 * judged. Nothing is decrypted: HTTPS is a tunnel and the browser still
 * verifies the certificate itself.
 */
export async function startEgressProxy(options: BrowserEgressOptions): Promise<BrowserEgressProxy> {
  // Loaded here, not at import: node:http pulls Node's bundled fetch client in on SDK import,
  // and most runs never open a browser.
  const { default: http } = await import('node:http');
  const resolve = options.resolve ?? systemBrowserResolver;
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const server = http.createServer();
  server.on('connection', track);

  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = split(request.url ?? '');
    if (target === undefined) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    void egressDecision(target, options.allowHosts, resolve).then((decision) => {
      if ('refused' in decision) {
        options.onRefused(`${target.host}:${String(target.port)}: ${decision.refused}`);
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      const upstream = net.connect({ host: decision.address, port: target.port });
      track(upstream);
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once('error', () => client.destroy());
      client.once('close', () => upstream.destroy());
    });
  });

  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '');
    } catch {
      response.writeHead(400).end();
      return;
    }
    const target = { host: url.hostname, port: Number(url.port === '' ? 80 : url.port) };
    if (url.protocol !== 'http:') {
      response.writeHead(400).end();
      return;
    }
    void egressDecision(target, options.allowHosts, resolve).then((decision) => {
      if ('refused' in decision) {
        options.onRefused(`${target.host}:${String(target.port)}: ${decision.refused}`);
        response.writeHead(403, { [BROWSER_EGRESS_HEADER]: 'refused' }).end();
        return;
      }
      const headers = { ...request.headers };
      for (const name of HOP_HEADERS) Reflect.deleteProperty(headers, name);
      const upstream = http.request(
        {
          host: decision.address,
          port: target.port,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers,
          agent: false,
          setHost: false,
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.pipe(upstream);
      response.once('close', () => upstream.destroy());
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    server: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          done();
        });
      }),
  };
}
