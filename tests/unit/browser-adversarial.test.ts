import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadPlaywright } from '../../src/sdk/browser-session';
import { createBrowserTool } from '../../src/sdk/browser-tool';

import type { BrowserTool } from '../../src/sdk/browser-tool.types';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

async function canLaunch(): Promise<boolean> {
  try {
    const playwright = await loadPlaywright();
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

vi.setConfig({ testTimeout: 45_000, hookTimeout: 30_000 });

const real = describe.skipIf(!(await canLaunch()));

type Result = Record<string, unknown>;

const call = async (
  tool: BrowserTool,
  operation: string,
  args: Record<string, unknown> = {},
): Promise<Result> => (await tool.execute(operation, args)) as Result;

const hits: string[] = [];
let victim: Server;
let attacker: Server;
let victimPort = 0;
let attackerPort = 0;

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
};

function pages(): Record<string, string> {
  const target = `127.0.0.1:${String(victimPort)}`;
  return {
    '/ws': `<title>ws</title><body>ws<script>
      const s = new WebSocket('ws://${target}/socket');
      s.onopen = () => console.error('WS OPEN'); s.onerror = () => console.error('ws refused');</script>`,
    '/worker': `<title>wk</title><body>wk<script>
      new Worker('/worker.js').onmessage = (e) => console.error('WORKER ' + e.data);</script>`,
    '/fetch': `<title>fetch</title><body>f<script>
      fetch('http://${target}/fetched', { mode: 'no-cors' }).catch(() => console.error('fetch refused'));
      new Image().src = 'http://${target}/img';</script>`,
    '/spin': '<title>spin</title><body><button id="b" onclick="while(true){}">spin</button>',
    '/password':
      '<title>pw</title><body><input id="pw" type="password" value="PrefilledSecret99"><input id="t" value="plain">',
  };
}

beforeAll(async () => {
  victim = createServer((request, response) => {
    hits.push(`${request.method ?? ''} ${request.url ?? ''}`);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>VICTIM</title><body>VICTIM-SECRET</body>');
  });
  victim.on('upgrade', (request, socket) => {
    hits.push(`UPGRADE ${request.url ?? ''}`);
    socket.destroy();
  });
  victimPort = await listen(victim);
  attacker = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    if (path === '/worker.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(
        `try { const w = new WebSocket('ws://127.0.0.1:${String(victimPort)}/worker-socket');
          w.onopen = () => postMessage('open'); w.onerror = () => postMessage('refused'); } catch (e) { postMessage('threw'); }`,
      );
      return;
    }
    if (path === '/redirect-to-name') {
      response.writeHead(302, { location: `http://rebinder.example:${String(victimPort)}/` });
      response.end();
      return;
    }
    const html = pages()[path] ?? '<title>home</title><body>home</body>';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  attackerPort = await listen(attacker);
});

afterAll(async () => {
  for (const server of [victim, attacker]) {
    server.closeAllConnections();
    await new Promise<void>((done) =>
      server.close(() => {
        done();
      }),
    );
  }
});

const toolFor = (extra: Record<string, unknown> = {}): BrowserTool =>
  createBrowserTool({
    allowHosts: [`127.0.0.1:${String(attackerPort)}`],
    resolver: (host) =>
      Promise.resolve(
        host === 'rebinder.example' || host === 'friend.example' ? ['127.0.0.1'] : [],
      ),
    ...extra,
  });

real('browser.page against a hostile page and a hostile name', () => {
  it('blocks a page WebSocket to a private host: the victim never sees a handshake', async () => {
    const tool = toolFor();
    hits.length = 0;
    await call(tool, 'open', { url: `http://127.0.0.1:${String(attackerPort)}/ws` });
    await call(tool, 'wait', { ms: 700 });
    const consoleLog = JSON.stringify(await call(tool, 'console'));
    tool.dispose();
    expect(consoleLog).toContain('ws refused');
    expect(consoleLog).not.toContain('WS OPEN');
    expect(hits).toEqual([]);
  });

  it('blocks a WebSocket made from inside a Worker', async () => {
    const tool = toolFor();
    hits.length = 0;
    await call(tool, 'open', { url: `http://127.0.0.1:${String(attackerPort)}/worker` });
    await call(tool, 'wait', { ms: 900 });
    const consoleLog = JSON.stringify(await call(tool, 'console'));
    tool.dispose();
    expect(consoleLog).toContain('WORKER refused');
    expect(hits).toEqual([]);
  });

  it('blocks page fetch and image loads to a private host and reports them', async () => {
    const tool = toolFor();
    hits.length = 0;
    const opened = await call(tool, 'open', {
      url: `http://127.0.0.1:${String(attackerPort)}/fetch`,
    });
    tool.dispose();
    expect(JSON.stringify(opened.refusedByAddressCheck)).toContain('private or local');
    expect(hits).toEqual([]);
  });

  it('refuses a public-looking name that resolves to loopback, on open and after a redirect', async () => {
    const tool = toolFor();
    hits.length = 0;
    await expect(
      call(tool, 'open', { url: `http://rebinder.example:${String(victimPort)}/` }),
    ).rejects.toThrow(/rebinder\.example resolves to 127\.0\.0\.1/u);
    await expect(
      call(tool, 'open', { url: `http://127.0.0.1:${String(attackerPort)}/redirect-to-name` }),
    ).rejects.toThrow(/resolves to 127\.0\.0\.1/u);
    tool.dispose();
    expect(hits).toEqual([]);
  });

  it('refuses localhost with a trailing dot', async () => {
    const tool = toolFor();
    hits.length = 0;
    await expect(
      call(tool, 'open', { url: `http://localhost.:${String(victimPort)}/` }),
    ).rejects.toThrow(/private or local host/u);
    tool.dispose();
    expect(hits).toEqual([]);
  });

  it('opens the same private name once the operator lists it', async () => {
    const tool = toolFor({ allowHosts: [`friend.example:${String(victimPort)}`] });
    const opened = await call(tool, 'open', {
      url: `http://friend.example:${String(victimPort)}/`,
    });
    tool.dispose();
    expect(opened.title).toBe('VICTIM');
  });

  it('closes the browser and fails the call when a page spins forever', async () => {
    const tool = toolFor({ maxCallMs: 2_000 });
    await call(tool, 'open', { url: `http://127.0.0.1:${String(attackerPort)}/spin` });
    const started = Date.now();
    await expect(call(tool, 'click', { selector: '#b' })).rejects.toThrow(
      /did not finish within 2 s|not found or not ready/u,
    );
    await expect(call(tool, 'snapshot')).rejects.toThrow(
      /did not finish within 2 s|No page is open/u,
    );
    expect(Date.now() - started).toBeLessThan(20_000);
    await expect(call(tool, 'snapshot')).rejects.toThrow(/No page is open/u);
    tool.dispose();
  });

  it('never puts a password field value in a snapshot, typed or prefilled', async () => {
    const tool = toolFor();
    await call(tool, 'open', { url: `http://127.0.0.1:${String(attackerPort)}/password` });
    await call(tool, 'type', { selector: '#pw', text: 'TypedSecret12345' });
    const snapshot = JSON.stringify(await call(tool, 'snapshot'));
    tool.dispose();
    expect(snapshot).not.toContain('TypedSecret12345');
    expect(snapshot).not.toContain('PrefilledSecret99');
    expect(snapshot).toContain('[hidden]');
    expect(snapshot).toContain('plain');
  });
});
