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
      const responsePromise = fetch(
        `${server.callbackUri}?code=authorization-code&state=expected-state`,
      );
      await expect(completion).resolves.toBe('authorization-code');
      const earlyResponse = await Promise.race([
        responsePromise.then(() => 'responded'),
        new Promise<string>((resolve) =>
          setTimeout(() => {
            resolve('pending');
          }, 20),
        ),
      ]);
      expect(earlyResponse).toBe('pending');

      server.confirmAuthorization();
      const response = await responsePromise;
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('Connected to ClawAI');
      expect(body).toContain('close automatically');
    } finally {
      server.dispose();
    }
  });

  it('shows a safe failure page when candidate credentials cannot be verified', async () => {
    const server = await LoopbackAuthorizationServer.open('expected-state', 2_000);
    try {
      const completion = server.waitForCallback();
      const responsePromise = fetch(
        `${server.callbackUri}?code=authorization-code&state=expected-state`,
      );
      await expect(completion).resolves.toBe('authorization-code');

      server.rejectAuthorization();

      const response = await responsePromise;
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Sign-in was not completed');
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
