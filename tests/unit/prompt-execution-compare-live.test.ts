import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { PromptExecutionService } from '../../src/services/prompt-execution-service';
import { parallelResponse } from '../helpers/parallel-response';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

import type { CompareLiveChange } from '../../src/core/compare-lane-accumulator.types';

const model = (provider: string, name: string) => ({
  contextTokens: 128_000,
  displayName: name,
  id: `${provider}:${name}`,
  isLocal: false,
  key: `${provider}:${name}`,
  model: name,
  provider,
  source: 'connector',
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsTools: true,
  supportsVision: true,
});

function sse(events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
}

function frame(provider: string, name: string, delta: string) {
  return {
    type: 'content_delta',
    laneId: `message-1:${provider}:${name}`,
    delta,
    provider,
    model: name,
  };
}

/**
 * One frame per read. The stream refills before a read's frame is handled, so
 * the request is cancelled while the second lane's frame is still unhandled.
 */
function cancellingStream(
  frames: readonly Record<string, unknown>[],
  cancel: () => void,
): Response {
  const encoder = new TextEncoder();
  let step = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(stream) {
        step += 1;
        if (step === 3) {
          cancel();
        }
        const frame = frames[step - 1];
        if (frame !== undefined) {
          stream.enqueue(
            encoder.encode(`data: ${JSON.stringify(frame)}

`),
          );
        }
        if (step >= frames.length) {
          stream.close();
        }
      },
    }),
  );
}

/** Only the dependencies the Compare path reaches; the chat and agent paths are covered elsewhere. */
function subject(options: { cancelAfterFirstLane?: boolean } = {}) {
  const postCompareLive = vi.fn(
    async (_change: CompareLiveChange, _requestId: string) => undefined,
  );
  const postResult = vi.fn(async () => undefined);
  const controller = new AbortController();
  const compare = vi.fn(async () => ({ ...parallelResponse(), judgeEnabled: true, responses: [] }));
  const frames = [
    frame('PROVIDER_A', 'model-a', 'Alpha'),
    frame('PROVIDER_B', 'model-b', 'Beta'),
    { type: 'done' },
  ];
  const openStream = vi.fn(async () =>
    options.cancelAfterFirstLane === true
      ? cancellingStream(frames, () => {
          controller.abort();
        })
      : sse(frames),
  );
  const session = {
    authorize: vi.fn(),
    isPlanMode: () => false,
    preparePrompt: (text: string) => text,
  };
  const service = new PromptExecutionService({
    activateThread: vi.fn(),
    assertAdmission: vi.fn(),
    attachments: {
      acquire: vi.fn(async () => ({ accept: vi.fn(), fileIds: [], rollback: vi.fn() })),
    },
    backend: () => ({ compare, listMessages: async () => [], openStream }),
    captureAdmission: vi.fn(() => ({ session: Promise.resolve(session), threadId: 'thread-1' })),
    collect: vi.fn(async () => ({
      files: [],
      receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
    })),
    configuration: { read: testRuntimeConfiguration },
    conversations: {
      forgetRequest: vi.fn(),
      prepare: vi.fn(async () => 'session-1'),
      threadForRequest: vi.fn(async () => 'thread-1'),
    },
    generations: {
      enqueue: vi.fn(
        async (
          _id: string,
          _kind: string,
          _prompt: string,
          run: (signal: AbortSignal) => Promise<void>,
        ) => {
          await run(controller.signal);
        },
      ),
    },
    projectRules: vi.fn(async () => ''),
    state: {
      snapshot: { models: [model('PROVIDER_A', 'model-a'), model('PROVIDER_B', 'model-b')] },
      update: vi.fn(),
    },
    view: () => ({
      postCompareLive,
      postEvent: vi.fn(async () => undefined),
      postResult,
      releaseRequest: vi.fn(),
    }),
  } as never);
  return { postCompareLive, postResult, service };
}

const request = {
  content: 'Compare these',
  contextMode: 'workspace' as const,
  judgeEnabled: true,
  modelKeys: ['PROVIDER_A:model-a', 'PROVIDER_B:model-b'],
  requestId: 'request-live',
  sessionId: 'session-1',
};

describe('PromptExecutionService compare, live', () => {
  it('hands each lane and then the verdict to the panel before the final result', async () => {
    const live = subject();

    await live.service.compare(request);

    const calls = live.postCompareLive.mock.calls;
    expect(
      calls.map(
        ([change, id]) => `${id}:${change.kind === 'lane' ? change.lane.delta : change.kind}`,
      ),
    ).toEqual(['request-live:Alpha', 'request-live:Beta', 'request-live:judge-verdict']);
    expect(live.postCompareLive.mock.invocationCallOrder[2]).toBeLessThan(
      live.postResult.mock.invocationCallOrder[0] ?? 0,
    );
    expect(live.postResult).toHaveBeenCalledWith(
      expect.objectContaining({ compare: expect.objectContaining({ judgeVerdict: null }) }),
      'request-live',
    );
  });

  it('stops posting live updates once the request is cancelled', async () => {
    const live = subject({ cancelAfterFirstLane: true });

    await expect(live.service.compare(request)).rejects.toThrow();

    expect(live.postCompareLive).toHaveBeenCalledTimes(1);
    expect(live.postResult).not.toHaveBeenCalled();
  });
});
