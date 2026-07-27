import { describe, expect, it, vi } from 'vitest';

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
  it('opens the authenticated stream before sending and emits attributed deltas', async () => {
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
            type: 'PROVIDER_SELECTED',
            provider: 'OLLAMA',
            model: 'qwen3-coder',
          },
          {
            type: 'CONTENT_DELTA',
            delta: 'hello',
          },
          {
            type: 'DONE',
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
    });
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('src/a.ts'),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'CONTENT_DELTA' }));
  });

  it('caps the assembled prompt below the backend message limit', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'DONE' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    const service = new ChatService(backend);

    await service.send(
      {
        content: 'Question',
        context: [{ path: 'large.ts', content: 'x'.repeat(150_000) }],
        routingMode: 'AUTO',
      },
      () => undefined,
    );

    const request = vi.mocked(backend.sendMessage).mock.calls[0]?.[0];
    expect(new TextEncoder().encode(request?.content ?? '').byteLength).toBeLessThanOrEqual(95_000);
  });

  it('reuses a thread, sends manual model provenance, and accepts streaming snapshots', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'unused' })),
      openStream: vi.fn(async () =>
        streamResponse([
          {
            type: 'RESPONSE_STREAMING',
            content: 'complete snapshot',
            provider: 'OPENAI',
            model: 'gpt-5',
          },
          { type: 'DONE' },
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
          routingMode: 'MANUAL',
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
        provider: 'OPENAI',
        model: 'gpt-5',
        modelDisplayName: 'GPT-5',
      }),
    );
    expect(onThread).toHaveBeenCalledWith('existing-thread');
  });

  it('falls back to the latest attributed assistant message after an empty stream', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => streamResponse([{ type: 'DONE' }])),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
      listMessages: vi.fn(async () => [
        { role: 'ASSISTANT', content: 'older' },
        { role: 'USER', content: 'question' },
        {
          role: 'ASSISTANT',
          content: 'final answer',
          provider: 'OLLAMA',
          model: 'qwen3-coder',
        },
      ]),
    };

    await expect(
      new ChatService(backend).send(
        { content: 'Question', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).resolves.toMatchObject({
      content: 'final answer',
      provider: 'OLLAMA',
      model: 'qwen3-coder',
    });
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
        streamResponse([{ type: 'ERROR', error: 'Provider unavailable' }]),
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
});
