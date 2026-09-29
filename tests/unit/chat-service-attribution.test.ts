import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { UsageAttributionLedger } from '../../src/core/usage-attribution';
import { ChatService, type ChatBackendPort } from '../../src/services/chat-service';
import { CheckpointStore } from '../../src/services/checkpoint-store';

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

function backend(events: Record<string, unknown>[]): ChatBackendPort & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  return {
    createThread: vi.fn(async () => ({ id: 'thread-1' })),
    openStream: vi.fn(async () => streamResponse(events)),
    sendMessage: vi.fn(async () => ({ id: 'message-1' })),
  };
}

describe('ChatService usage attribution', () => {
  it('charges a turn to its source and to the model that answered', async () => {
    const ledger = new UsageAttributionLedger();
    const port = backend([
      { type: 'content_delta', delta: 'hi', provider: 'openai', model: 'gpt' },
      { type: 'usage', usage: { promptTokens: 12, completionTokens: 3, cachedPromptTokens: 2 } },
      { type: 'done' },
    ]);
    await new ChatService(port, () => undefined, ledger).send(
      {
        content: 'Explain',
        context: [],
        routingMode: 'AUTO',
        attribution: { kind: 'workflow', name: 'explain' },
      },
      () => undefined,
    );

    const summary = ledger.summary();
    expect(summary.bySource[0]).toMatchObject({
      dimension: 'workflow: explain',
      input: 12,
      output: 3,
      cached: 2,
    });
    expect(summary.byModel[0]?.dimension).toBe('openai/gpt');
    const sent = port.sendMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('attribution');
  });

  it('charges an unlabelled turn to chat and to the requested model', async () => {
    const ledger = new UsageAttributionLedger();
    await new ChatService(backend([{ type: 'done' }]), () => undefined, ledger).send(
      { content: 'Hi', context: [], routingMode: 'MANUAL_MODEL', provider: 'x', model: 'y' },
      () => undefined,
    );
    expect(ledger.summary().bySource[0]?.dimension).toBe('chat');
    expect(ledger.summary().byModel[0]?.dimension).toBe('x/y');
  });

  it('records nothing for a turn that failed', async () => {
    const ledger = new UsageAttributionLedger();
    await expect(
      new ChatService(backend([{ type: 'error', error: 'boom' }]), () => undefined, ledger).send(
        { content: 'Hi', context: [], routingMode: 'AUTO' },
        () => undefined,
      ),
    ).rejects.toThrow('boom');
    expect(ledger.summary().turns).toBe(0);
  });
});

describe('CheckpointStore under zero data retention', () => {
  it('keeps checkpoints for the session without writing them to workspace storage', async () => {
    const durable = new Map<string, unknown>();
    const storage = {
      get: (key: string) => durable.get(key),
      update: (key: string, value: unknown) => {
        durable.set(key, value);
        return Promise.resolve();
      },
    };
    const store = new CheckpointStore(storage, () => true);
    await store.clear();
    expect(durable.size).toBe(0);
    expect(store.read()).toEqual([]);
  });
});
