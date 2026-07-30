import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { ChatService, type ChatBackendPort } from '../../src/services/chat-service';

function streamResponse(events: Record<string, unknown>[]): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    }),
  );
}

describe('ChatService', () => {
  it('normalizes the backend lowercase stream protocol and terminates on done', async () => {
    const calls: string[] = [];
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => {
        calls.push('thread');
        return { id: 'thread-1' };
      }),
      openStream: vi.fn(async () => {
        calls.push('stream');
        return streamResponse([
          {
            type: 'provider_selected',
            provider: 'OLLAMA',
            model: 'qwen3-coder',
          },
          {
            type: 'content_delta',
            delta: 'hello',
          },
          {
            type: 'usage',
            usage: {
              completionTokens: 7,
              costAvailable: false,
              promptTokens: 11,
              totalTokens: 18,
            },
          },
          {
            type: 'done',
          },
        ]);
      }),
      sendMessage: vi.fn(async () => {
        calls.push('message');
        return { id: 'message-1' };
      }),
    };
    const service = new ChatService(backend);
    const events: Record<string, unknown>[] = [];

    const result = await service.send(
      {
        content: 'Explain this',
        context: [
          {
            path: 'src/a.ts',
            content: 'export const a = 1;',
          },
        ],
        routingMode: 'AUTO',
      },
      (event) => {
        events.push(event);
      },
    );

    expect(calls).toEqual(['thread', 'stream', 'message']);
    expect(result).toMatchObject({
      content: 'hello',
      model: 'qwen3-coder',
      provider: 'OLLAMA',
      threadId: 'thread-1',
      tokens: {
        input: 11,
        output: 7,
        source: 'reported',
        total: 18,
      },
    });
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientIntent: 'Explain this',
        content: expect.stringContaining('src/a.ts'),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'CONTENT_DELTA' }));
  });

  it('labels prompt and response token counts as estimated when the provider omits usage', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([{ type: 'content_delta', delta: 'hello' }, { type: 'done' }]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    const result = await new ChatService(backend).send(
      { content: 'Question', context: [], routingMode: 'AUTO' },
      () => undefined,
    );

    expect(result.tokens.source).toBe('estimated');
    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.tokens.output).toBeGreaterThan(0);
    expect(result.tokens.total).toBe(result.tokens.input + result.tokens.output);
  });

  it('caps the assembled prompt below the backend message limit', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'DONE' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    const service = new ChatService(backend);

    const result = await service.send(
      {
        content: 'Question',
        context: [
          { path: 'small.ts', content: 'export {};\n' },
          { path: 'large.ts', content: 'x'.repeat(150_000) },
        ],
        contextReceipt: {
          excluded: [{ path: 'ignored.ts', reason: 'excluded' }],
          included: ['small.ts', 'large.ts'],
          totalBytes: 150_011,
          truncated: false,
        },
        routingMode: 'AUTO',
      },
      () => undefined,
    );

    const request = vi.mocked(backend.sendMessage).mock.calls[0]?.[0];
    expect(new TextEncoder().encode(request?.content ?? '').byteLength).toBeLessThanOrEqual(95_000);
    expect(request?.content).toContain('small.ts');
    expect(request?.content).not.toContain('large.ts');
    expect(result.contextReceipt).toEqual({
      excluded: [
        { path: 'ignored.ts', reason: 'excluded' },
        { path: 'large.ts', reason: 'limit' },
      ],
      included: ['small.ts'],
      totalBytes: 11,
      truncated: true,
    });
  });

  it('forwards caller cancellation through both stream setup and message submission', async () => {
    const controller = new AbortController();
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'done' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    await new ChatService(backend).send(
      { content: 'Question', context: [], routingMode: 'AUTO' },
      () => undefined,
      controller.signal,
    );

    expect(backend.openStream).toHaveBeenCalledWith('thread-1', controller.signal);
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1' }),
      controller.signal,
    );
  });

  it('reuses a thread, sends the MANUAL_MODEL backend contract, and accepts snapshots', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'unused' })),
      openStream: vi.fn(async () =>
        streamResponse([
          {
            type: 'response_streaming',
            content: 'complete snapshot',
            provider: 'OPENAI',
            model: 'gpt-5',
          },
          { type: 'done' },
        ]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    const service = new ChatService(backend);
    const onThread = vi.fn();

    await expect(
      service.send(
        {
          content: 'Explain',
          context: [],
          routingMode: 'MANUAL_MODEL',
          provider: 'OPENAI',
          model: 'gpt-5',
          modelDisplayName: 'GPT-5',
          threadId: 'existing-thread',
        },
        () => undefined,
        undefined,
        onThread,
      ),
    ).resolves.toMatchObject({
      threadId: 'existing-thread',
      content: 'complete snapshot',
      provider: 'OPENAI',
      model: 'gpt-5',
    });
    expect(backend.createThread).not.toHaveBeenCalled();
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        routingMode: 'MANUAL_MODEL',
        provider: 'OPENAI',
        model: 'gpt-5',
        modelDisplayName: 'GPT-5',
      }),
    );
    expect(onThread).toHaveBeenCalledWith('existing-thread');
  });

  it('forwards uploaded file IDs on the request that owns the attachments', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'done' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    await new ChatService(backend).send(
      {
        content: 'Inspect these files',
        context: [],
        fileIds: ['file-image', 'file-source'],
        routingMode: 'AUTO',
      },
      () => undefined,
    );

    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fileIds: ['file-image', 'file-source'],
      }),
    );
  });

  it('keeps an empty completed response isolated from older thread messages', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'done' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    await expect(
      new ChatService(backend).send(
        { content: 'Question', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).resolves.toMatchObject({ content: '' });
  });

  it('rejects a live stream that closes without the current request DONE event', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([{ type: 'content_delta', delta: 'stale answer' }]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    await expect(
      new ChatService(backend).send(
        { content: 'New question', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).rejects.toThrow('closed before the request completed');
  });

  it('cancels an opened SSE body when message submission is rejected', async () => {
    const cancel = vi.fn();
    const accepted = vi.fn();
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel,
            }),
          ),
      ),
      sendMessage: vi.fn(async () => {
        throw new Error('message rejected');
      }),
    };

    await expect(
      new ChatService(backend).send(
        { content: 'Question', context: [], routingMode: 'AUTO' },
        () => undefined,
        undefined,
        undefined,
        accepted,
      ),
    ).rejects.toThrow('message rejected');
    expect(accepted).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('publishes the transport receipt before a rejected message submission', async () => {
    const order: string[] = [];
    const receipts: unknown[] = [];
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: vi.fn(),
            }),
          ),
      ),
      sendMessage: vi.fn(async () => {
        order.push('submit');
        throw new Error('message rejected');
      }),
    };
    const service = new ChatService(backend, (receipt) => {
      order.push('receipt');
      receipts.push(receipt);
    });

    await expect(
      service.send(
        {
          content: 'Inspect the workspace',
          context: [
            { path: 'src/small.ts', content: 'export {};\n' },
            { path: 'src/large.ts', content: 'x'.repeat(150_000) },
          ],
          contextReceipt: {
            excluded: [],
            included: ['src/small.ts', 'src/large.ts'],
            totalBytes: 150_011,
            truncated: false,
          },
          routingMode: 'AUTO',
        },
        () => undefined,
      ),
    ).rejects.toThrow('message rejected');

    expect(order).toEqual(['receipt', 'submit']);
    expect(receipts).toEqual([
      {
        excluded: [{ path: 'src/large.ts', reason: 'limit' }],
        included: ['src/small.ts'],
        totalBytes: 11,
        truncated: true,
      },
    ]);
  });

  it('publishes the transport receipt when stream setup fails', async () => {
    const receipts: unknown[] = [];
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => {
        throw new Error('stream unavailable');
      }),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    const service = new ChatService(backend, (receipt) => {
      receipts.push(receipt);
    });

    await expect(
      service.send(
        {
          content: 'Inspect the workspace',
          context: [{ path: 'src/app.ts', content: 'export {};\n' }],
          contextReceipt: {
            excluded: [],
            included: ['src/app.ts'],
            totalBytes: 11,
            truncated: false,
          },
          routingMode: 'AUTO',
        },
        () => undefined,
      ),
    ).rejects.toThrow('stream unavailable');

    expect(receipts).toEqual([
      {
        excluded: [],
        included: ['src/app.ts'],
        totalBytes: 11,
        truncated: false,
      },
    ]);
    expect(backend.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects missing streams and attributed generation errors', async () => {
    const noBodyBackend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => new Response(null)),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    await expect(
      new ChatService(noBodyBackend).send(
        { content: 'Question', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).rejects.toThrow('did not provide a response body');

    const errorBackend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([{ type: 'error', error: 'Provider unavailable' }]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    await expect(
      new ChatService(errorBackend).send(
        { content: 'Question', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).rejects.toThrow('Provider unavailable');
  });

  it('preserves structured SSE error metadata without replacing the safe user message', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([
          {
            type: 'error',
            code: 'PROVIDER_BUSY',
            error: 'The selected provider is temporarily unavailable.',
            errorMessageKey: 'chat.errors.providerBusy',
            retryable: true,
          },
        ]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    const failure = await new ChatService(backend)
      .send({ content: 'Question', context: [], routingMode: 'AUTO' }, () => undefined)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'The selected provider is temporarily unavailable.',
      metadata: {
        code: 'PROVIDER_BUSY',
        key: 'chat.errors.providerBusy',
        retryable: true,
      },
    });
  });

  it('keeps raw error translation keys in metadata and out of the visible message', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([
          {
            type: 'error',
            code: 'PROVIDER_BUSY',
            error: 'chat.errors.providerBusy',
            errorMessageKey: 'chat.errors.providerBusy',
            retryable: false,
          },
        ]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    const failure = await new ChatService(backend)
      .send({ content: 'Question', context: [], routingMode: 'AUTO' }, () => undefined)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'ClawAI request failed.',
      metadata: {
        code: 'PROVIDER_BUSY',
        key: 'chat.errors.providerBusy',
        retryable: false,
      },
    });
    expect((failure as Error).message).not.toContain('chat.errors.providerBusy');
  });

  it('uses a safe structured SSE description when no user-facing error is present', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () =>
        streamResponse([
          {
            type: 'error',
            code: 'VIDEO_UNSUPPORTED',
            description: 'The selected provider cannot process this video.',
            retryable: false,
          },
        ]),
      ),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    const failure = await new ChatService(backend)
      .send({ content: 'Question', context: [], routingMode: 'AUTO' }, () => undefined)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'The selected provider cannot process this video.',
      metadata: {
        code: 'VIDEO_UNSUPPORTED',
        retryable: false,
      },
    });
  });
});
