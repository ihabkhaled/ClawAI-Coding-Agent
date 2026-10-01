import type { CompareRequest } from '../backend/backend-client.types';
import type { ChatMessage, ParallelResponse } from '../backend/contracts';

export interface CompareBackend extends CompareStreamBackend {
  compare(input: CompareRequest, signal?: AbortSignal): Promise<ParallelResponse>;
}

export interface CompareRunInput {
  backend: CompareBackend;
  request: CompareRequest;
  signal: AbortSignal;
  /** Told the thread the run belongs to as soon as the server accepts it. */
  onAccepted: (threadId: string) => void;
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
  onProgress: (event: Record<string, unknown>) => void;
  signal: AbortSignal;
}
