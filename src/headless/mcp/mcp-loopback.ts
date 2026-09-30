import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { MCP_LOGIN_CALLBACK_PATH, MCP_LOGIN_LOOPBACK_HOST } from './mcp-login.constants';

import type { McpAuthorizationCallback } from '../../services/mcp-oauth-service.types';
import type { ServerResponse } from 'node:http';

const PAGE_OK = 'Authorization complete. You can close this tab and return to the terminal.';
const PAGE_FAILED = 'Authorization was not completed. Return to the terminal.';

function reply(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function sameState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A one-shot listener on 127.0.0.1 and an ephemeral port that waits for the
 * authorization server's redirect.
 *
 * The state must match, or the request is answered 400 and the wait goes on; a
 * stray request cannot end a sign-in, and cannot complete one. A `Host` other
 * than the listener's own is refused (DNS rebinding). The wait has a hard
 * timeout, after which the port is closed. No code or state is ever logged.
 */
export async function openLoopbackCallback(
  expectedState: string,
  timeoutMs: number,
): Promise<McpAuthorizationCallback> {
  let settled = false;
  let pending: ServerResponse | undefined;
  let host = '';
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const completion = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  void completion.catch(() => undefined);
  const server = createServer();
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode(new Error('MCP authorization timed out'));
    }
    server.close();
  }, timeoutMs);
  timer.unref();

  const verified = (request: { headers: { host?: string | undefined } }, url: URL): boolean => {
    const state = url.searchParams.get('state');
    return (
      !settled && request.headers.host === host && state !== null && sameState(state, expectedState)
    );
  };
  server.on('request', (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const denied = url.searchParams.has('error');
    if (request.method !== 'GET') {
      reply(response, 405, 'Method not allowed');
    } else if (url.pathname !== MCP_LOGIN_CALLBACK_PATH) {
      reply(response, 404, 'Not found');
    } else if (!verified(request, url) || (code === null && !denied)) {
      reply(response, 400, 'Authorization could not be verified.');
    } else if (code === null || denied) {
      settled = true;
      clearTimeout(timer);
      reply(response, 400, PAGE_FAILED);
      rejectCode(new Error('MCP authorization was denied'));
      server.close();
    } else {
      settled = true;
      clearTimeout(timer);
      pending = response;
      resolveCode(code);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, MCP_LOGIN_LOOPBACK_HOST, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not start the authorization callback listener.');
  }
  host = `${MCP_LOGIN_LOOPBACK_HOST}:${String(address.port)}`;
  const finish = (ok: boolean): void => {
    const response = pending;
    pending = undefined;
    if (response !== undefined) reply(response, ok ? 200 : 400, ok ? PAGE_OK : PAGE_FAILED);
    server.close();
  };
  return {
    callbackUri: `http://${host}${MCP_LOGIN_CALLBACK_PATH}`,
    waitForCallback: () => completion,
    confirmAuthorization: () => {
      finish(true);
    },
    rejectAuthorization: () => {
      finish(false);
    },
    dispose: () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        rejectCode(new Error('MCP authorization was cancelled'));
      }
      finish(false);
      server.closeAllConnections();
    },
  };
}
