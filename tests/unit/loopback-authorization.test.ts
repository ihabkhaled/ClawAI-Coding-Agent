import { describe, expect, it } from 'vitest';

import { LoopbackAuthorizationServer } from '../../src/core/loopback-authorization';

describe('LoopbackAuthorizationServer', () => {
  it('accepts one state-bound callback on an ephemeral IPv4 loopback port', async () => {
    const server = await LoopbackAuthorizationServer.open('expected-state', 2_000);
    try {
      expect(server.callbackUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/u);
      const wrong = await fetch(`${server.callbackUri}?code=authorization-code&state=wrong-state`);
      expect(wrong.status).toBe(400);

      const completion = server.waitForCallback();
      const response = await fetch(
        `${server.callbackUri}?code=authorization-code&state=expected-state`,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Authorization complete');
      await expect(completion).resolves.toBe('authorization-code');
    } finally {
      server.dispose();
    }
  });

  it('rejects wrong paths and resolves disposal as a cancelled authorization', async () => {
    const server = await LoopbackAuthorizationServer.open('expected-state', 2_000);
    const wrongPath = await fetch(
      `${server.callbackUri.replace('/auth/callback', '/other')}?code=code&state=expected-state`,
    );
    expect(wrongPath.status).toBe(404);

    const completion = server.waitForCallback();
    server.dispose();
    await expect(completion).rejects.toThrow(/cancelled/iu);
  });
});
