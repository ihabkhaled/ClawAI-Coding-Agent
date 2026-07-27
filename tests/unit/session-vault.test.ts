import { describe, expect, it } from 'vitest';

import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

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

describe('SessionVault', () => {
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

    await vault.save(tokens);
    await expect(vault.load()).resolves.toEqual(tokens);
    expect([...storage.values.values()].join(' ')).not.toContain('password');

    await vault.clear();
    await expect(vault.load()).resolves.toBeNull();
  });

  it('fails closed and clears corrupted token data', async () => {
    const storage = new MemorySecretStorage();
    storage.values.set('clawAI.session', '{"accessToken":42}');
    const vault = new SessionVault(storage);

    await expect(vault.load()).resolves.toBeNull();
    expect(storage.values.size).toBe(0);
  });
});
