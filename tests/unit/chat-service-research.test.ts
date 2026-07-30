import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { ChatService, type ChatBackendPort } from '../../src/services/chat-service';

function completedStream(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    }),
  );
}

describe('ChatService research requests', () => {
  it('forwards explicit research mode without converting requests into tokens', async () => {
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => completedStream()),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };

    await new ChatService(backend).send(
      {
        content: 'Find current documentation',
        context: [],
        researchMode: 'SEARCH_FETCH',
        routingMode: 'AUTO',
      },
      () => undefined,
    );

    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ researchMode: 'SEARCH_FETCH' }),
    );
  });
});
