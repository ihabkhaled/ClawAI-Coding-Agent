import { describe, expect, it } from 'vitest';

import { SessionVault, type SecretStoragePort, type TokenPair } from '../../src/core/session-vault';

const BACKEND_URL = 'https://rotation.claw.example';

const storedTokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
  refreshExpiresIn: 2_592_000,
  tokenType: 'Bearer' as const,
};

const rotatedTokens = {
  ...storedTokens,
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
};

class MemorySecretStorage implements SecretStoragePort {
  readonly values = new Map<string, string>();

  get(key: string): Thenable<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Thenable<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe('SessionVault rotation durability', () => {
  it('stores the rotated pair the backend issued', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);

    const outcome = await vault.refreshIfCurrent(BACKEND_URL, new AbortController().signal, () =>
      Promise.resolve(rotatedTokens),
    );

    expect(outcome).toBe('refreshed');
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(rotatedTokens);
  });

  // The backend kills the presented refresh token the moment it answers, so a
  // replacement that is thrown away leaves a consumed credential in storage.
  // The next refresh replays it, the backend reads that as a stolen token and
  // revokes the family, and the user is signed out mid-run. Revision drift
  // during the round trip therefore may not discard the replacement.
  it('keeps the rotated pair when the record moved during the round trip', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);

    const outcome = await vault.refreshIfCurrent(
      BACKEND_URL,
      new AbortController().signal,
      async (): Promise<TokenPair> => {
        await vault.invalidate(BACKEND_URL);
        return rotatedTokens;
      },
    );

    expect(outcome).toBe('refreshed');
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(rotatedTokens);
  });

  it('keeps the rotated pair when the caller cancelled after the backend answered', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);
    const controller = new AbortController();

    const outcome = await vault.refreshIfCurrent(BACKEND_URL, controller.signal, () => {
      controller.abort(new Error('Caller cancelled.'));
      return Promise.resolve(rotatedTokens);
    });

    expect(outcome).toBe('refreshed');
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(rotatedTokens);
  });

  it('never resurrects a session that was cleared while the rotation was in flight', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);

    const outcome = await vault.refreshIfCurrent(
      BACKEND_URL,
      new AbortController().signal,
      async (): Promise<TokenPair> => {
        await vault.clear(BACKEND_URL);
        return rotatedTokens;
      },
    );

    expect(outcome).toBe('missing');
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('never overwrites a different account signed in while the rotation was in flight', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);
    const replacement = {
      ...storedTokens,
      accessToken: 'other-account-access',
      refreshToken: 'other-account-refresh',
    };

    const outcome = await vault.refreshIfCurrent(
      BACKEND_URL,
      new AbortController().signal,
      async (): Promise<TokenPair> => {
        await vault.save(BACKEND_URL, replacement);
        return rotatedTokens;
      },
    );

    expect(outcome).toBe('changed');
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(replacement);
  });

  it('refuses to rotate a session that already belongs to another account', async () => {
    const vault = new SessionVault(new MemorySecretStorage());
    await vault.save(BACKEND_URL, storedTokens);
    let rotations = 0;

    const outcome = await vault.refreshIfCurrent(
      BACKEND_URL,
      new AbortController().signal,
      () => {
        rotations += 1;
        return Promise.resolve(rotatedTokens);
      },
      'a-session-that-is-not-current',
    );

    expect(outcome).toBe('changed');
    expect(rotations).toBe(0);
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(storedTokens);
  });
});
