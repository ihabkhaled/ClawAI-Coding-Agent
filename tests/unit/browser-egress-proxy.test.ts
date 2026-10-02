import http from 'node:http';
import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startEgressProxy } from '../../src/sdk/browser-egress-proxy';
import { BROWSER_EGRESS_HEADER } from '../../src/sdk/browser-tool.constants';

import type { BrowserEgressProxy } from '../../src/sdk/browser-egress.types';

const CLOSE_GET = ['GET / HTTP/1.1', 'Host: x', 'Connection: close', '', ''].join('\r\n');
const upstreamHits: string[] = [];
const resolved: string[] = [];
const refused: string[] = [];
let upstream: http.Server;
let upstreamPort = 0;
let proxy: BrowserEgressProxy;
let proxyPort = 0;

const resolver = (host: string): Promise<readonly string[]> => {
  resolved.push(host);
  if (host === 'friend.test.example') return Promise.resolve(['127.0.0.1']);
  if (host === 'evil.test.example') return Promise.resolve(['127.0.0.1']);
  return Promise.reject(new Error('ENOTFOUND'));
};

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    upstreamHits.push(`${request.method ?? ''} ${request.url ?? ''}`);
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('upstream-body');
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  upstreamPort = (upstream.address() as net.AddressInfo).port;
  proxy = await startEgressProxy({
    allowHosts: ['friend.test.example'],
    resolve: resolver,
    onRefused: (reason) => refused.push(reason),
  });
  proxyPort = Number(new URL(proxy.server).port);
});

afterAll(async () => {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise<void>((done) =>
    upstream.close(() => {
      done();
    }),
  );
});

function connectThrough(target: string, payload?: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let text = '';
    let sent = false;
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.includes('200 Connection Established') && payload !== undefined && !sent) {
        sent = true;
        socket.write(payload);
      }
      if (text.includes('upstream-body') || text.includes('403')) socket.end();
    });
    socket.on('close', () => {
      resolve(text);
    });
    socket.on('error', () => {
      resolve(text);
    });
  });
}

describe('browser egress proxy', () => {
  it('tunnels CONNECT to a listed name, dialling the address that was judged', async () => {
    upstreamHits.length = 0;
    const text = await connectThrough(
      `friend.test.example:${String(upstreamPort)}`,
      'GET /tunnel HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    );
    expect(text).toContain('200 Connection Established');
    expect(text).toContain('upstream-body');
    expect(upstreamHits).toEqual(['GET /tunnel']);
  });

  it('refuses CONNECT to a public-looking name that points at loopback, and says why', async () => {
    upstreamHits.length = 0;
    refused.length = 0;
    const text = await connectThrough(`evil.test.example:${String(upstreamPort)}`);
    expect(text).toContain('403 Forbidden');
    expect(upstreamHits).toEqual([]);
    expect(refused.join(' ')).toContain('evil.test.example resolves to 127.0.0.1');
  });

  it.each(['127.0.0.1', '[::1]', 'localhost', 'localhost.', '169.254.169.254', '10.0.0.1'])(
    'refuses CONNECT to %s',
    async (host) => {
      upstreamHits.length = 0;
      const text = await connectThrough(`${host}:${String(upstreamPort)}`);
      expect(text).toContain('403 Forbidden');
      expect(upstreamHits).toEqual([]);
    },
  );

  it('answers a malformed CONNECT with 400 and keeps serving', async () => {
    expect(await connectThrough('[::1:80')).toContain('400');
    expect(
      await connectThrough(`friend.test.example:${String(upstreamPort)}`, CLOSE_GET),
    ).toContain('200');
  });

  it('forwards a plain HTTP request to a listed name and strips proxy headers', async () => {
    upstreamHits.length = 0;
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: `http://friend.test.example:${String(upstreamPort)}/plain?a=1`,
          headers: { host: `friend.test.example:${String(upstreamPort)}` },
        },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
          response.on('end', () => {
            resolve({ status: response.statusCode ?? 0, body });
          });
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(answer).toEqual({ status: 200, body: 'upstream-body' });
    expect(upstreamHits).toEqual(['GET /plain?a=1']);
  });

  it('refuses a plain HTTP request to a private target and marks the answer', async () => {
    upstreamHits.length = 0;
    const status = await new Promise<{ code: number; marked: boolean }>((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          path: `http://evil.test.example:${String(upstreamPort)}/`,
        },
        (response) => {
          response.resume();
          resolve({
            code: response.statusCode ?? 0,
            marked: response.headers[BROWSER_EGRESS_HEADER] !== undefined,
          });
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toEqual({ code: 403, marked: true });
    expect(upstreamHits).toEqual([]);
  });

  it('is not an open relay for a relative path or a non-http scheme', async () => {
    const codes = await Promise.all(
      ['/just/a/path', 'ftp://friend.test.example/x'].map(
        (path) =>
          new Promise<number>((resolve, reject) => {
            const request = http.request(
              { host: '127.0.0.1', port: proxyPort, path },
              (response) => {
                response.resume();
                resolve(response.statusCode ?? 0);
              },
            );
            request.on('error', reject);
            request.end();
          }),
      ),
    );
    expect(codes).toEqual([400, 400]);
  });

  it('asks the resolver once per connection and never connects to a second answer', async () => {
    resolved.length = 0;
    await connectThrough(`friend.test.example:${String(upstreamPort)}`, CLOSE_GET);
    expect(resolved).toEqual(['friend.test.example']);
  });
});
