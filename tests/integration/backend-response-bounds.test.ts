import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendClient, BackendRequestError } from '../../src/backend/backend-client';
import { SessionVault, type SecretStoragePort } from '../../src/core/session-vault';

const BACKEND_URL = 'https://bounds.claw.example';

class MemorySecretStorage implements SecretStoragePort {
  private readonly values = new Map<string, string>();

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

async function clientFor(fetcher: typeof fetch, timeoutMs = 1_000): Promise<BackendClient> {
  const vault = new SessionVault(new MemorySecretStorage());
  await vault.save(BACKEND_URL, {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshExpiresIn: 2_592_000,
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
  });
  return new BackendClient({
    backendUrl: BACKEND_URL,
    fetcher,
    sessionVault: vault,
    timeoutMs,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BackendClient response bounds', () => {
  it('terminates a connected SSE stream that remains silent past the idle deadline', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Headers arrive, but the provider never emits a stream event.
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    const client = await clientFor(vi.fn<typeof fetch>().mockResolvedValue(response), 25);
    const stream = await client.openStream('thread-silent');
    const reader = stream.body?.getReader();

    await expect(reader?.read()).rejects.toThrow(
      'ClawAI live stream timed out while waiting for data.',
    );
  });

  it('resets the SSE idle deadline after every received chunk', async () => {
    let emitted = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => {
            setTimeout(resolve, 30);
          });
          emitted += 1;
          if (emitted <= 3) {
            controller.enqueue(new TextEncoder().encode(`data: ${String(emitted)}\n\n`));
          } else {
            controller.close();
          }
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    const client = await clientFor(vi.fn<typeof fetch>().mockResolvedValue(response), 100);
    const stream = await client.openStream('thread-active');
    const reader = stream.body?.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const result = await reader?.read();
      if (result === undefined || result.done) {
        break;
      }
      chunks.push(result.value);
    }

    expect(chunks).toHaveLength(3);
  });

  it('cancels the upstream SSE body when the caller aborts an active read', async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel: cancelled,
        start() {
          // Keep one read pending so cancellation has to reach the source.
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
    const controller = new AbortController();
    const client = await clientFor(vi.fn<typeof fetch>().mockResolvedValue(response));
    const stream = await client.openStream('thread-cancelled', controller.signal);
    const reader = stream.body?.getReader();
    const read = reader?.read();

    controller.abort(new Error('Run cancelled.'));

    await expect(read).rejects.toThrow('Run cancelled.');
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('keeps the request deadline active while a success body is still streaming', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Intentionally leave the body open until the request deadline aborts it.
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    const client = await clientFor(vi.fn<typeof fetch>().mockResolvedValue(response), 25);

    await expect(client.getProfile()).rejects.toMatchObject({
      message: 'ClawAI request timed out.',
      retryable: true,
      status: 0,
    });
  });

  it('rejects a success body before buffering more than the hard ceiling', async () => {
    const oversizedProfile = JSON.stringify({
      id: 'user-1',
      email: 'dev@example.com',
      username: 'dev',
      role: 'USER',
      permissions: [],
      mustChangePassword: false,
      languagePreference: 'en',
      appearancePreference: 'SYSTEM',
      padding: 'x'.repeat(8_000_000),
    });
    const client = await clientFor(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(oversizedProfile, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const error = await client.getProfile().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BackendRequestError);
    expect(error).toMatchObject({ retryable: false, status: 200 });
  });

  it('rejects an oversized error body without buffering or reflecting it', async () => {
    const client = await clientFor(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(`secret=${'x'.repeat(64_001)}`, { status: 503 })),
    );

    const error = await client.getUsage().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BackendRequestError);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain('secret=');
  });
});
