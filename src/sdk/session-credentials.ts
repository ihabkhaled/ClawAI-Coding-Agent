import { HeadlessTransport } from '../headless/headless-transport';

import type { RuntimeTransportPort } from './agent-sdk.types';
import type { AgentAuth } from './create-agent.types';

/** A static token that came with a refresh token is renewed for the whole run. */
export function adoptRefreshableSession(transport: RuntimeTransportPort, auth: AgentAuth): void {
  if (!(transport instanceof HeadlessTransport) || !('token' in auth)) return;
  if (auth.refreshToken === undefined || auth.refreshToken.length === 0) return;
  transport.adoptSession({ accessToken: auth.token, refreshToken: auth.refreshToken });
}

/**
 * The access token as it is now. Tools that call the backend directly read it
 * when they need it, so a token renewed mid-run is the one they use.
 */
export function liveTokenOf(
  transport: RuntimeTransportPort,
  fallback: { token: string | undefined },
): () => string | undefined {
  return () =>
    (transport instanceof HeadlessTransport ? transport.currentToken() : undefined) ??
    fallback.token;
}
