import { randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

import { parseVscodeAuthorizationCallback } from './vscode-authorization';

import type { Server } from 'node:http';

const CALLBACK_PATH = '/auth/callback';
const LOOPBACK_HOST = '127.0.0.1';
function respond(response: ServerResponse, status: number, body: string, csp?: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': csp ?? "default-src 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function authorizationPage(
  success: boolean,
  translate: (message: string) => string,
): { body: string; csp: string } {
  const translated = (message: string): string => escapeHtml(translate(message));
  const nonce = randomBytes(16).toString('base64');
  const title = success
    ? translated('Connected to ClawAI')
    : translated('Sign-in was not completed');
  const message = success
    ? translated('Your identity was verified. Return to VS Code to start building.')
    : translated('ClawAI could not verify this sign-in. Return to VS Code and try again.');
  const status = success ? translated('SECURE SESSION READY') : translated('VERIFICATION FAILED');
  const tone = success ? '#3ddc97' : '#ff6b7a';
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style nonce="${nonce}">:root{color-scheme:dark}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,#17344a 0,transparent 38%),#080b10;color:#f4f7fb;font:16px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(560px,100%);padding:42px;border:1px solid #294257;border-radius:24px;background:linear-gradient(145deg,rgba(24,35,48,.96),rgba(10,14,20,.98));box-shadow:0 24px 80px #0009}.mark{display:grid;place-items:center;width:52px;height:52px;margin-bottom:26px;border:1px solid ${tone};border-radius:16px;color:${tone};font-size:24px;box-shadow:0 0 32px ${tone}33}.eyebrow{color:${tone};font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.13em}h1{margin:12px 0 10px;font-size:clamp(28px,6vw,40px);line-height:1.08}p{margin:0;color:#b9c6d3}.hint{margin-top:28px;padding-top:20px;border-top:1px solid #263543;color:#8fa0b1;font-size:14px}button,a{display:inline-block;text-decoration:none;margin-inline-end:12px;margin-top:22px;padding:11px 18px;border:1px solid #45647d;border-radius:10px;background:#172534;color:#f4f7fb;font:inherit;cursor:pointer}</style></head><body><main><div class="mark" aria-hidden="true">${success ? '&#10003;' : '!'}</div><div class="eyebrow">${status}</div><h1>${title}</h1><p>${message}</p><p class="hint">${success ? translated('You can safely close this tab and return to VS Code.') : translated('No session was saved.')}</p><a href="vscode://clawai.clawai-coding-agent/open">${translated('Open Chat')}</a><button id="close" type="button">${translated('Close this tab')}</button><p id="close-fallback" class="hint" role="status" hidden>${translated('Your browser kept this tab open. Close it using the tab close button or Ctrl+W (Command+W on Mac), then return to VS Code.')}</p></main><script nonce="${nonce}">history.replaceState(null,'',location.pathname);document.getElementById('close').addEventListener('click',()=>{window.close();setTimeout(()=>{document.getElementById('close-fallback').hidden=false;},150);});</script></body></html>`;
  return {
    body,
    csp: `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
  };
}

export class LoopbackAuthorizationServer {
  private callbackUriValue = '';
  private readonly completion: Promise<string>;
  private rejectCompletion: ((error: Error) => void) | undefined;
  private resolveCompletion: ((code: string) => void) | undefined;
  private pendingResponse: ServerResponse | undefined;
  private settled = false;
  private timeout: NodeJS.Timeout | undefined;

  private constructor(
    private readonly expectedState: string,
    private readonly server: Server,
    private readonly translate: (message: string) => string,
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
    translate: (message: string) => string = (message) => message,
  ): Promise<LoopbackAuthorizationServer> {
    const server = createServer();
    const instance = new LoopbackAuthorizationServer(state, server, translate);
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

  confirmAuthorization(): void {
    this.finishAuthorization(true);
  }

  rejectAuthorization(): void {
    this.finishAuthorization(false);
  }

  dispose(): void {
    this.rejectAuthorization();
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
      this.pendingResponse = response;
      this.resolveCompletion?.(parsed.code);
    } catch {
      respond(response, 400, 'Authorization could not be verified.');
    }
  }

  private finishAuthorization(success: boolean): void {
    const response = this.pendingResponse;
    if (response === undefined) {
      return;
    }
    this.pendingResponse = undefined;
    const page = authorizationPage(success, this.translate);
    respond(response, success ? 200 : 400, page.body, page.csp);
    this.server.close();
  }

  private clearTimeout(): void {
    if (this.timeout !== undefined) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}
