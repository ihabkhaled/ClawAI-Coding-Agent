import * as vscode from 'vscode';

import { CompareLaneAccumulator } from '../core/compare-lane-accumulator';
import { SseDecoder } from '../core/sse-decoder';

import { normalizeStreamEvent } from './chat-service';
import { LANE_CONTENT_EVENTS } from './compare-stream-collector.constants';

import type {
  CompareRunInput,
  CompareStreamBackend,
  CompareStreamRequest,
} from './compare-stream-collector.types';
import type { ChatMessage, ParallelResponse } from '../backend/contracts';

type LaneResult = ParallelResponse['responses'][number];

/**
 * Sends a compare request and returns every lane's result, whether the server
 * answers with the finished lanes or accepts the run and streams them.
 */
export async function runCompare(input: CompareRunInput): Promise<ParallelResponse> {
  const { backend, request, signal } = input;
  const early = await openCompareStreamEarly(backend, request.threadId, signal);
  let accepted: ParallelResponse;
  try {
    accepted = await backend.compare(request, signal);
  } catch (error: unknown) {
    await discardCompareStream(early);
    throw error;
  }
  signal.throwIfAborted();
  input.onAccepted(accepted.threadId);
  if (!compareRunIsAsync(accepted)) {
    await discardCompareStream(early);
    return accepted;
  }
  return collectCompareRun({ accepted, backend, early, onProgress: input.onProgress, signal });
}

/** The server answers a compare with `responses: []` and streams the lanes. */
export function compareRunIsAsync(response: ParallelResponse): boolean {
  return response.responses.length === 0;
}

export async function openCompareStreamEarly(
  backend: CompareStreamBackend,
  threadId: string | undefined,
  signal: AbortSignal,
): Promise<Response | undefined> {
  return threadId === undefined ? undefined : backend.openStream(threadId, signal, false);
}

export async function discardCompareStream(response: Response | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The caller's own failure is the one worth reporting, not stream cleanup.
  }
}

/** Reads the thread stream until the run's DONE, then reconciles with stored lane messages. */
export async function collectCompareRun(request: CompareStreamRequest): Promise<ParallelResponse> {
  const { accepted, backend, signal } = request;
  const response = request.early ?? (await backend.openStream(accepted.threadId, signal, true));
  const lanes = new CompareLaneAccumulator(accepted.messageId);
  const startedAt = Date.now();
  await readUntilDone(response, lanes, request.onProgress);
  signal.throwIfAborted();
  const streamed = lanes.result(accepted);
  const stored = await storedLaneMessages(backend, accepted);
  return {
    ...streamed,
    totalLatencyMs: Date.now() - startedAt,
    responses: streamed.responses.map((lane) => mergeStoredLane(lane, stored)),
  };
}

/** A labelled, run-wide status event: launching, judging. Lane text and the final DONE are not progress. */
function isRunProgress(event: Record<string, unknown>): boolean {
  return (
    event.laneId === undefined &&
    typeof event.label === 'string' &&
    typeof event.content !== 'string' &&
    !LANE_CONTENT_EVENTS.has(String(event.type))
  );
}

async function readUntilDone(
  response: Response,
  lanes: CompareLaneAccumulator,
  onProgress: (event: Record<string, unknown>) => void,
): Promise<void> {
  const body = response.body;
  if (body === null) {
    throw new Error(vscode.l10n.t('ClawAI stream did not provide a response body.'));
  }
  const reader = body.getReader();
  const text = new TextDecoder();
  const decoder = new SseDecoder();
  try {
    while (!lanes.finished) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      for (const raw of decoder.push(text.decode(read.value, { stream: true }))) {
        const event = normalizeStreamEvent(raw);
        if (event.type === 'HEARTBEAT') {
          continue;
        }
        lanes.apply(event);
        // Lane text is rendered as one card per model when the run ends; a
        // stray delta here would interleave every lane into one bubble.
        if (isRunProgress(event)) {
          onProgress(event);
        }
      }
    }
    if (!lanes.finished) {
      throw new Error(vscode.l10n.t('ClawAI live stream closed before the request completed.'));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function storedLaneMessages(
  backend: CompareStreamBackend,
  accepted: ParallelResponse,
): Promise<ChatMessage[]> {
  try {
    const messages = await backend.listMessages(accepted.threadId);
    return messages.filter((message) => message.metadata?.parallelGroupId === accepted.messageId);
  } catch {
    // The streamed answers are complete without the stored copy; only the
    // judge verdict and exact latency are lost, which the cards omit.
    return [];
  }
}

function mergeStoredLane(lane: LaneResult, stored: ChatMessage[]): LaneResult {
  const match = stored.find(
    (message) => message.provider === lane.provider && message.model === lane.model,
  );
  if (match === undefined) {
    return lane;
  }
  return {
    ...lane,
    latencyMs: match.latencyMs ?? lane.latencyMs,
    inputTokens: match.inputTokens ?? lane.inputTokens,
    outputTokens: match.outputTokens ?? lane.outputTokens,
    judgeReview: match.metadata?.judgeReview ?? null,
  };
}
