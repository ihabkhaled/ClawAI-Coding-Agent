import { describe, expect, it, vi } from 'vitest';

import { BackendClient, BackendRequestError } from '../../src/backend/backend-client';
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

const initialTokens = {
  accessToken: 'expired-access',
  refreshToken: 'valid-refresh',
  expiresIn: 900,
  refreshExpiresIn: 2_592_000,
  tokenType: 'Bearer' as const,
};

const rotatedTokens = {
  ...initialTokens,
  accessToken: 'fresh-access',
  refreshToken: 'rotated-refresh',
};

const profile = {
  id: 'user-1',
  email: 'dev@example.com',
  username: 'dev',
  role: 'USER',
  permissions: [],
  mustChangePassword: false,
  languagePreference: 'en',
  appearancePreference: 'SYSTEM',
};

const meta = {
  total: 1,
  page: 1,
  limit: 100,
  totalPages: 1,
};

const usage = {
  day: {
    used: 1,
    limit: 100,
    remaining: 99,
    periodKey: '2026-07-27',
  },
  week: {
    used: 2,
    limit: 700,
    remaining: 698,
    periodKey: '2026-W31',
  },
  month: {
    used: 3,
    limit: 3_000,
    remaining: 2_997,
    periodKey: '2026-07',
  },
  features: [],
};

const entitlements = {
  userId: 'user-1',
  role: 'USER',
  isAdmin: false,
  permissions: [],
  plan: null,
  allowedModels: [],
  allowedProviders: [],
  quota: {
    dailyLimit: 100,
    used: 1,
    remaining: 99,
    unlimited: false,
  },
};

const thread = {
  id: 'thread-1',
  title: 'Thread',
};

const message = {
  id: 'message-1',
  threadId: 'thread-1',
  role: 'ASSISTANT',
  content: 'Hello',
};

function authenticatedClient(fetcher: typeof fetch) {
  const storage = new MemorySecretStorage();
  const vault = new SessionVault(storage);
  return vault.save(initialTokens).then(() => ({
    client: new BackendClient({
      backendUrl: 'https://claw.example',
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    }),
    storage,
    vault,
  }));
}

describe('BackendClient', () => {
  it('refreshes a rejected session once and retries with the rotated access token', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    await vault.save(initialTokens);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          tokens: rotatedTokens,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...profile,
        }),
      );
    const client = new BackendClient({
      backendUrl: 'https://claw.example',
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    });

    await expect(client.getProfile()).resolves.toMatchObject({ id: 'user-1' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain('/api/v1/auth/refresh');
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-access',
      }),
    });
    await expect(vault.load()).resolves.toEqual(rotatedTokens);
  });

  it('identifies login sessions as VS Code without persisting the password', async () => {
    const storage = new MemorySecretStorage();
    const vault = new SessionVault(storage);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        tokens: initialTokens,
        user: profile,
      }),
    );
    const client = new BackendClient({
      backendUrl: 'https://claw.example',
      fetcher,
      sessionVault: vault,
      timeoutMs: 1_000,
    });

    await client.login('dev@example.com', 'one-time-password');

    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(request?.body?.toString() ?? '{}')).toMatchObject({
      clientKind: 'VSCODE',
      email: 'dev@example.com',
    });
    expect([...storage.values.values()].join(' ')).not.toContain('one-time-password');
  });

  it('maps every authenticated backend contract and preserves API versioning', async () => {
    const responses: Record<string, unknown> = {
      'GET /api/v1/auth/me': profile,
      'GET /api/v1/auth/me/entitlements': entitlements,
      'GET /api/v1/auth/me/usage': usage,
      'GET /api/v1/routing/models': {
        data: [
          {
            id: 'router-1',
            provider: 'OLLAMA',
            modelKey: 'qwen3-coder',
            displayName: 'Qwen 3 Coder',
            isLocal: true,
            isExecutionCapable: true,
            lifecycle: 'ACTIVE',
          },
        ],
        meta,
      },
      'GET /api/v1/connectors/available-models': [
        {
          id: 'connector-model-1',
          connectorId: 'connector-1',
          provider: 'OPENAI',
          modelKey: 'gpt-5',
          displayName: 'GPT-5',
          lifecycle: 'ACTIVE',
          supportsStreaming: true,
          supportsTools: true,
          supportsVision: true,
          supportsAudio: false,
          supportsStructuredOutput: true,
          maxContextTokens: 200_000,
        },
      ],
      'POST /api/v1/chat-threads': thread,
      'GET /api/v1/chat-threads': { data: [thread], meta },
      'GET /api/v1/chat-messages/thread/thread-1': { data: [message], meta },
      'POST /api/v1/chat-messages': message,
      'POST /api/v1/chat-messages/parallel': {
        messageId: 'parallel-1',
        threadId: 'thread-1',
        prompt: 'Compare',
        responses: [
          {
            provider: 'OPENAI',
            model: 'gpt-5',
            content: 'A',
            latencyMs: 10,
            inputTokens: 1,
            outputTokens: 1,
            status: 'completed',
            errorMessage: null,
          },
          {
            provider: 'OLLAMA',
            model: 'qwen3-coder',
            content: 'B',
            latencyMs: 20,
            inputTokens: 1,
            outputTokens: 1,
            status: 'completed',
            errorMessage: null,
          },
        ],
        totalLatencyMs: 20,
        completedCount: 2,
        failedCount: 0,
        judgeEnabled: false,
        judgeModel: null,
      },
      'POST /api/v1/chat-messages/stream/thread-1/cancel': null,
    };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input.toString());
      const path = url.pathname;
      expect(path).toMatch(/^\/api\/v1\//u);
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer expired-access',
      });
      if (path === '/api/v1/routing/models') {
        expect(url.searchParams.get('isExecutionCapable')).toBe('true');
      }
      const key = `${init?.method ?? 'GET'} ${path}`;
      if (!(key in responses)) {
        throw new Error(`Unexpected request: ${url.toString()}`);
      }
      const body = responses[key];
      if (body === null) {
        return new Response(null, { status: 204 });
      }
      return Response.json(body);
    });
    const { client } = await authenticatedClient(fetcher);

    await expect(client.getProfile()).resolves.toEqual(profile);
    await expect(client.getEntitlements()).resolves.toEqual(entitlements);
    await expect(client.getUsage()).resolves.toEqual(usage);
    await expect(client.getRouterModels()).resolves.toHaveLength(1);
    await expect(client.getConnectorModels()).resolves.toHaveLength(1);
    await expect(client.createThread({ routingMode: 'AUTO' })).resolves.toEqual(thread);
    await expect(client.listThreads()).resolves.toEqual([thread]);
    await expect(client.listMessages('thread-1')).resolves.toEqual([message]);
    await expect(
      client.sendMessage({
        threadId: 'thread-1',
        content: 'Hello',
        routingMode: 'AUTO',
      }),
    ).resolves.toEqual(message);
    await expect(
      client.compare({
        content: 'Compare',
        models: [
          { provider: 'OPENAI', model: 'gpt-5' },
          { provider: 'OLLAMA', model: 'qwen3-coder' },
        ],
      }),
    ).resolves.toMatchObject({ completedCount: 2 });
    await expect(client.cancelStream('thread-1')).resolves.toBeUndefined();
  });

  it('opens an event stream with the SSE accept header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {"type":"DONE"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const { client } = await authenticatedClient(fetcher);

    await expect(client.openStream('thread-1')).resolves.toBeInstanceOf(Response);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: 'text/event-stream',
    });
  });

  it('logs out remotely and clears local tokens even when the backend rejects logout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('busy', { status: 503 }));
    const { client, vault } = await authenticatedClient(fetcher);

    await expect(client.logout()).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    await expect(vault.load()).resolves.toBeNull();
  });

  it('fails closed without a session and redacts backend error bodies', async () => {
    const emptyVault = new SessionVault(new MemorySecretStorage());
    const withoutSession = new BackendClient({
      backendUrl: 'https://claw.example',
      fetcher: vi.fn<typeof fetch>(),
      sessionVault: emptyVault,
      timeoutMs: 1_000,
    });
    await expect(withoutSession.getUsage()).rejects.toBeInstanceOf(BackendRequestError);

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('token=do-not-log', { status: 429 }));
    const { client } = await authenticatedClient(fetcher);
    const error = await client.getUsage().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BackendRequestError);
    expect(error).toMatchObject({ status: 429, retryable: true });
    expect(String(error)).not.toContain('do-not-log');
  });

  it('rejects invalid backend contracts and wraps network failures', async () => {
    const invalidFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ nope: true }));
    const { client: invalidClient } = await authenticatedClient(invalidFetcher);
    await expect(invalidClient.getProfile()).rejects.toThrow();

    const networkFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network failed with Bearer abc.def.secret'));
    const { client: networkClient } = await authenticatedClient(networkFetcher);
    const error = await networkClient.getUsage().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status: 0, retryable: true });
    expect(String(error)).not.toContain('abc.def.secret');
  });
});
