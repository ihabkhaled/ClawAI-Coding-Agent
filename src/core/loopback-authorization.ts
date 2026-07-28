import { createServer, type ServerResponse } from 'node:http';

import { parseVscodeAuthorizationCallback } from './vscode-authorization';

import type { Server } from 'node:http';

const CALLBACK_PATH = '/auth/callback';
const LOOPBACK_HOST = '127.0.0.1';
const COMPLETE_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ClawAI authorization complete</title>
  <style>body{font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#e8e8e8;background:#181818}main{padding:24px;border:1px solid #444;border-radius:12px}h1{font-size:1.35rem}</style>
</head>
<body><main><h1>Authorization complete</h1><p>ClawAI is connected. You can close this tab and return to VS Code.</p></main></body>
</html>`;

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(body);
}

export class LoopbackAuthorizationServer {
  private callbackUriValue = '';
  private readonly completion: Promise<string>;
  private rejectCompletion: ((error: Error) => void) | undefined;
  private resolveCompletion: ((code: string) => void) | undefined;
  private settled = false;
  private timeout: NodeJS.Timeout | undefined;

  private constructor(
    private readonly expectedState: string,
    private readonly server: Server,
  ) {
    this.completion = new Promise<string>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    void this.completion.catch(() => undefined);
  }

  static async open(
    state: string,
    timeoutMs = 10 * 60 * 1_000,
  ): Promise<LoopbackAuthorizationServer> {
    const server = createServer();
    const instance = new LoopbackAuthorizationServer(state, server);
    server.on('request', (request, response) => {
      instance.handle(request.url, request.method, response);
    });
    await instance.listen(timeoutMs);
    return instance;
  }

  get callbackUri(): string {
    return this.callbackUriValue;
  }

  waitForCallback(): Promise<string> {
    return this.completion;
  }

  dispose(): void {
    if (!this.settled) {
      this.settled = true;
      this.rejectCompletion?.(new Error('ClawAI authorization was cancelled.'));
    }
    this.clearTimeout();
    this.server.close();
  }

  private async listen(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, LOOPBACK_HOST, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      this.dispose();
      throw new Error('ClawAI could not start its authorization callback.');
    }
    this.callbackUriValue = `http://${LOOPBACK_HOST}:${String(address.port)}${CALLBACK_PATH}`;
    this.timeout = setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.rejectCompletion?.(new Error('ClawAI authorization timed out. Please try again.'));
      }
      this.server.close();
    }, timeoutMs);
    this.timeout.unref();
  }

  private handle(
    url: string | undefined,
    method: string | undefined,
    response: ServerResponse,
  ): void {
    if (method !== 'GET' || url === undefined) {
      respond(response, 405, 'Method not allowed');
      return;
    }
    const callback = new URL(url, this.callbackUriValue);
    if (callback.pathname !== CALLBACK_PATH) {
      respond(response, 404, 'Not found');
      return;
    }
    try {
      const parsed = parseVscodeAuthorizationCallback(callback);
      if (parsed.state !== this.expectedState || this.settled) {
        throw new Error('ClawAI authorization state did not match.');
      }
      this.settled = true;
      this.clearTimeout();
      this.resolveCompletion?.(parsed.code);
      respond(response, 200, COMPLETE_PAGE);
      this.server.close();
    } catch {
      respond(response, 400, 'Authorization could not be verified.');
    }
  }

  private clearTimeout(): void {
    if (this.timeout !== undefined) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}
