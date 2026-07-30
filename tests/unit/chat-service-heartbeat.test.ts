import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ l10n: { t: (message: string) => message } }));

import { ChatService } from '../../src/services/chat-service';

import type { ChatBackendPort } from '../../src/services/chat-service';

describe('ChatService heartbeat', () => {
  it('keeps heartbeats out of visible activity and preserves explicit client intent', async () => {
    const payload = ['heartbeat', 'content_delta', 'done']
      .map(
        (type) =>
          `data: ${JSON.stringify(type === 'content_delta' ? { type, delta: 'ready' } : { type })}\n\n`,
      )
      .join('');
    const backend: ChatBackendPort = {
      createThread: vi.fn(async () => ({ id: 'thread-1' })),
      openStream: vi.fn(async () => new Response(payload)),
      sendMessage: vi.fn(async () => ({ id: 'message-1' })),
    };
    const events: Record<string, unknown>[] = [];
    const result = await new ChatService(backend).send(
      { content: 'Inspect', clientIntent: 'Original intent', context: [], routingMode: 'AUTO' },
      (event) => events.push(event),
    );
    expect(result.content).toBe('ready');
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'HEARTBEAT' }));
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ clientIntent: 'Original intent' }),
    );
  });
});
