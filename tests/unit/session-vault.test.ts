import { describe, expect, it } from 'vitest';

import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

const BACKEND_URL = 'https://vault.claw.example';
const LEGACY_SESSION_KEY = 'clawAI.session';

class MemorySecretStorage implements SecretStoragePort {
  failNextDelete = false;
  failNextStore = false;
  readonly values = new Map<string, string>();

  get(key: string): Thenable<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): Thenable<void> {
    if (this.failNextStore) {
      this.failNextStore = false;
      return Promise.reject(new Error('SecretStorage unavailable'));
    }
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Thenable<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.reject(new Error('SecretStorage delete unavailable'));
    }
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe('SessionVault', () => {
  it('recovers malformed scoped data before the first replacement attempt', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(BACKEND_URL, {
      accessToken: 'discarded-access',
      refreshToken: 'discarded-refresh',
    });
    const scopedKey = [...storage.values.keys()].find((key) =>
      key.startsWith('clawAI.session.v2.'),
    );
    expect(scopedKey).toBeDefined();
    storage.values.set(scopedKey ?? '', 'not-json');

    const generation = await vault.captureGeneration(BACKEND_URL);
    const committed = await vault.replaceIfCurrent(
      BACKEND_URL,
      { accessToken: 'new-access', refreshToken: 'new-refresh' },
      generation,
    );

    expect(committed).not.toBeNull();
    await expect(vault.finalizeReplacement(BACKEND_URL, committed ?? -1)).resolves.toBe(true);
    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('keeps sessions isolated between normalized backend endpoints', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    const firstTokens = {
      accessToken: 'first-access',
      refreshToken: 'first-refresh',
    };
    const secondTokens = {
      accessToken: 'second-access',
      refreshToken: 'second-refresh',
    };

    await vault.save('https://first.claw.example/api/v1/', firstTokens);
    await vault.save('https://second.claw.example', secondTokens);

    await expect(vault.load('https://first.claw.example')).resolves.toMatchObject(firstTokens);
    await expect(vault.load('https://second.claw.example/')).resolves.toMatchObject(secondTokens);
    await vault.clear('https://first.claw.example');
    await expect(vault.load('https://first.claw.example')).resolves.toBeNull();
    await expect(vault.load('https://second.claw.example')).resolves.toMatchObject(secondTokens);
  });

  it('discards an unattributed legacy session instead of assigning it to an origin', async () => {
    const storage = new MemorySecretStorage();
    storage.values.set(
      LEGACY_SESSION_KEY,
      JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }),
    );
    const vault = new SessionVault(storage);

    await expect(vault.migrateLegacy(BACKEND_URL)).resolves.toBeNull();
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
    await expect(vault.load('https://other.claw.example')).resolves.toBeNull();
    expect(storage.values.has(LEGACY_SESSION_KEY)).toBe(false);
  });

  it('keeps an existing scoped session instead of overwriting it with legacy data', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(BACKEND_URL, {
      accessToken: 'current-access',
      refreshToken: 'current-refresh',
    });
    storage.values.set(
      LEGACY_SESSION_KEY,
      JSON.stringify({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }),
    );

    await expect(vault.migrateLegacy(BACKEND_URL)).resolves.toMatchObject({
      accessToken: 'current-access',
      refreshToken: 'current-refresh',
    });
    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject({
      accessToken: 'current-access',
      refreshToken: 'current-refresh',
    });
    expect(storage.values.has(LEGACY_SESSION_KEY)).toBe(false);
  });

  it('deletes malformed legacy data and treats migration as disconnected', async () => {
    const storage = new MemorySecretStorage();
    storage.values.set(LEGACY_SESSION_KEY, 'not-json');
    const vault = new SessionVault(storage);

    await expect(vault.migrateLegacy(BACKEND_URL)).resolves.toBeNull();
    expect(storage.values.has(LEGACY_SESSION_KEY)).toBe(false);
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('never copies a legacy session when cleanup fails', async () => {
    const storage = new MemorySecretStorage();
    storage.values.set(
      LEGACY_SESSION_KEY,
      JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }),
    );
    storage.failNextDelete = true;
    const vault = new SessionVault(storage);

    await expect(vault.migrateLegacy(BACKEND_URL)).rejects.toThrow(
      'SecretStorage delete unavailable',
    );
    expect(storage.values.has(LEGACY_SESSION_KEY)).toBe(true);
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('never lets concurrent origins claim the same legacy session', async () => {
    const storage = new MemorySecretStorage();
    storage.values.set(
      LEGACY_SESSION_KEY,
      JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }),
    );
    const first = new SessionVault(storage);
    const second = new SessionVault(storage);

    await expect(
      Promise.all([
        first.migrateLegacy('https://first.claw.example'),
        second.migrateLegacy('https://second.claw.example'),
      ]),
    ).resolves.toEqual([null, null]);
    await expect(first.load('https://first.claw.example')).resolves.toBeNull();
    await expect(second.load('https://second.claw.example')).resolves.toBeNull();
  });

  it('can discard an unattributed legacy session without clearing scoped sessions', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(BACKEND_URL, {
      accessToken: 'scoped-access',
      refreshToken: 'scoped-refresh',
    });
    storage.values.set(
      LEGACY_SESSION_KEY,
      JSON.stringify({ accessToken: 'unknown-access', refreshToken: 'unknown-refresh' }),
    );

    await vault.clearLegacy();

    expect(storage.values.has(LEGACY_SESSION_KEY)).toBe(false);
    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject({
      accessToken: 'scoped-access',
      refreshToken: 'scoped-refresh',
    });
  });

  it('round-trips validated tokens through SecretStorage and clears them atomically', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    const tokens = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      tokenType: 'Bearer' as const,
    };

    await vault.save(BACKEND_URL, tokens);
    await expect(vault.load(BACKEND_URL)).resolves.toEqual(tokens);
    expect([...storage.values.values()].join(' ')).not.toContain('password');

    await vault.clear(BACKEND_URL);
    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('preserves session lineage across refreshes and rotates it across logins', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(BACKEND_URL, {
      accessToken: 'first-access',
      refreshToken: 'first-refresh',
    });
    const first = await vault.loadBound(BACKEND_URL);
    const generation = await vault.captureGeneration(BACKEND_URL);
    await vault.saveIfCurrent(
      BACKEND_URL,
      {
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
      },
      generation,
    );
    const refreshed = await vault.loadBound(BACKEND_URL);

    expect(refreshed?.sessionId).toBe(first?.sessionId);

    await vault.clear(BACKEND_URL);
    await vault.save(BACKEND_URL, {
      accessToken: 'second-access',
      refreshToken: 'second-refresh',
    });
    const second = await vault.loadBound(BACKEND_URL);
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });

  it('rolls back a cancelled candidate without erasing the pre-existing session', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    const previous = {
      accessToken: 'previous-access',
      refreshToken: 'previous-refresh',
    };
    await vault.save(BACKEND_URL, previous);
    const generation = await vault.captureGeneration(BACKEND_URL);
    await vault.replaceIfCurrent(
      BACKEND_URL,
      {
        accessToken: 'candidate-access',
        refreshToken: 'candidate-refresh',
      },
      generation,
    );

    await vault.invalidate(BACKEND_URL);
    await vault.rollbackReplacement(BACKEND_URL, generation);

    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject(previous);
  });

  it('keeps candidate credentials provisional until endpoint activation is finalized', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    const previous = {
      accessToken: 'previous-access',
      refreshToken: 'previous-refresh',
    };
    const candidate = {
      accessToken: 'candidate-access',
      refreshToken: 'candidate-refresh',
    };
    await vault.save(BACKEND_URL, previous);
    const generation = await vault.captureGeneration(BACKEND_URL);
    const committedGeneration = await vault.replaceIfCurrent(BACKEND_URL, candidate, generation);

    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject(previous);
    expect(committedGeneration).not.toBeNull();

    await vault.finalizeReplacement(BACKEND_URL, committedGeneration ?? -1);

    await expect(vault.load(BACKEND_URL)).resolves.toMatchObject(candidate);
  });

  it('rejects a stale save from another vault instance after logout', async () => {
    const storage = new MemorySecretStorage();
    const refreshingWindow = new SessionVault(storage);
    const loggingOutWindow = new SessionVault(storage);
    await refreshingWindow.save(BACKEND_URL, {
      accessToken: 'expired-access',
      refreshToken: 'valid-refresh',
    });
    const generation = await refreshingWindow.captureGeneration(BACKEND_URL);

    await loggingOutWindow.clear(BACKEND_URL);
    const saved = await refreshingWindow.saveIfCurrent(
      BACKEND_URL,
      {
        accessToken: 'stale-access',
        refreshToken: 'rotated-refresh',
      },
      generation,
    );

    expect(saved).toBe(false);
    await expect(loggingOutWindow.load(BACKEND_URL)).resolves.toBeNull();
  });

  it('rejects concurrent rotations captured from the same durable generation', async () => {
    const storage = new MemorySecretStorage();
    const firstWindow = new SessionVault(storage);
    const secondWindow = new SessionVault(storage);
    await firstWindow.save(BACKEND_URL, {
      accessToken: 'expired-access',
      refreshToken: 'valid-refresh',
    });
    const firstGeneration = await firstWindow.captureGeneration(BACKEND_URL);
    const secondGeneration = await secondWindow.captureGeneration(BACKEND_URL);

    const firstSaved = await firstWindow.saveIfCurrent(
      BACKEND_URL,
      {
        accessToken: 'first-access',
        refreshToken: 'first-refresh',
      },
      firstGeneration,
    );
    const secondSaved = await secondWindow.saveIfCurrent(
      BACKEND_URL,
      {
        accessToken: 'second-access',
        refreshToken: 'second-refresh',
      },
      secondGeneration,
    );

    expect([firstSaved, secondSaved]).toEqual([true, false]);
    await expect(firstWindow.load(BACKEND_URL)).resolves.toMatchObject({
      accessToken: 'first-access',
      refreshToken: 'first-refresh',
    });
  });

  it('fails closed and clears corrupted token data', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(BACKEND_URL, {
      accessToken: 'temporary-access',
      refreshToken: 'temporary-refresh',
    });
    const sessionKey = [...storage.values.keys()].at(-1) ?? '';
    storage.values.set(sessionKey, 'corrupted');

    await expect(vault.load(BACKEND_URL)).resolves.toBeNull();
    expect(storage.values.get(sessionKey)).not.toBe('corrupted');
    await expect(new SessionVault(storage).load(BACKEND_URL)).resolves.toBeNull();
  });

  it('normalizes legacy auth responses that omit expiry metadata and token type', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);

    await vault.save(BACKEND_URL, {
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
    });

    await expect(vault.load(BACKEND_URL)).resolves.toEqual({
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      tokenType: 'Bearer',
    });
  });
});
