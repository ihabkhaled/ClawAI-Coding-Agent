import type { CompareRequest } from '../backend/backend-client.types';
import type { ChatMessage, ParallelResponse } from '../backend/contracts';
import type { CompareLiveChange } from '../core/compare-lane-accumulator.types';

export interface CompareBackend extends CompareStreamBackend {
  compare(input: CompareRequest, signal?: AbortSignal): Promise<ParallelResponse>;
}

export interface CompareRunInput {
  backend: CompareBackend;
  request: CompareRequest;
  signal: AbortSignal;
  /** Told the thread the run belongs to as soon as the server accepts it. */
  onAccepted: (threadId: string) => void;
  /** Lane cards and the judge verdict, as each arrives. */
  onLive: (change: CompareLiveChange) => void;
  onProgress: (event: Record<string, unknown>) => void;
}

export interface CompareStreamBackend {
  listMessages(threadId: string, limit?: number): Promise<ChatMessage[]>;
  openStream(threadId: string, signal?: AbortSignal, replay?: boolean): Promise<Response>;
}

export interface CompareStreamRequest {
  accepted: ParallelResponse;
  backend: CompareStreamBackend;
  /** A stream opened before the request was sent, when the thread was already known. */
  early: Response | undefined;
  onLive: (change: CompareLiveChange) => void;
  onProgress: (event: Record<string, unknown>) => void;
  signal: AbortSignal;
}
