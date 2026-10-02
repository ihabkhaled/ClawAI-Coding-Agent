import { describe, expect, it } from 'vitest';

import { authFromEnvironment } from '../../src/headless/headless-args';
import { HeadlessTransport } from '../../src/headless/headless-transport';
import { adoptRefreshableSession, liveTokenOf } from '../../src/sdk/session-credentials';
import { startShortTokenServer } from '../helpers/short-token-server';

describe('CLAW_REFRESH_TOKEN', () => {
  it('rides with a static token and is ignored without one', () => {
    expect(authFromEnvironment({ CLAW_TOKEN: 'a', CLAW_REFRESH_TOKEN: 'r' })).toEqual({
      token: 'a',
      refreshToken: 'r',
    });
    expect(authFromEnvironment({ CLAW_TOKEN: 'a', CLAW_REFRESH_TOKEN: '' })).toEqual({
      token: 'a',
    });
    expect(authFromEnvironment({ CLAW_REFRESH_TOKEN: 'r' })).toBeUndefined();
  });

  it('makes the SDK renew a static token, and tools read the renewed one', async () => {
    const server = await startShortTokenServer({ ttlSeconds: 1, everyMs: 1_000, events: 1 });
    try {
      const transport = new HeadlessTransport(server.url);
      const pair = server.mint();
      adoptRefreshableSession(transport, {
        token: pair.accessToken,
        refreshToken: pair.refreshToken,
      });
      const live = liveTokenOf(transport, { token: pair.accessToken });
      expect(live()).toBe(pair.accessToken);
      // The fake token's expiry is rounded UP to a whole second, so it can live up to 2 s: wait
      // past the longest it can live, or a fast machine finds it not yet due for renewal.
      await new Promise((resolve) => setTimeout(resolve, 2_300));
      await transport.createThread(pair.accessToken, 't');
      expect(live()).not.toBe(pair.accessToken);
      expect(server.log.refreshes).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('adopts nothing for email and password or for a token alone', () => {
    const transport = new HeadlessTransport('http://x');
    adoptRefreshableSession(transport, { token: 'a' });
    adoptRefreshableSession(transport, { email: 'e', password: 'p' });
    expect(transport.currentToken()).toBeUndefined();
  });
});
