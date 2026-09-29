import { z } from 'zod';

import type { RoutingMode } from '../core/configuration';
import type { ResearchMode } from '../core/research-mode';
import type {
  RunBudget,
  ToolDefinition,
  ToolInvocation,
} from '../core/runtime/runtime-tool-contracts';
import type { SessionVault } from '../core/session-vault';

export const runtimeStartAckSchema = z
  .object({
    runId: z.string(),
    generation: z.string(),
    messageId: z.string(),
    sequence: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();
export const runtimeMutationAckSchema = z
  .object({
    runId: z.string(),
    sequence: z.number().int().nonnegative(),
    eventId: z.string(),
    replayed: z.boolean(),
  })
  .strict();

export type RuntimeStartAck = z.infer<typeof runtimeStartAckSchema>;
export type RuntimeMutationAck = z.infer<typeof runtimeMutationAckSchema>;

export interface RuntimeStartRequest {
  readonly schemaVersion: '2.0';
  readonly threadId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  /**
   * The files the user attached to this request.
   *
   * A run without them is the old behaviour and stays valid. Their absence was
   * the whole bug: a file dropped into an agentic request was discarded, while
   * the same file asked about conversationally reached the model, because that
   * path posts an ordinary chat message and those have always carried files.
   */
  readonly fileIds?: readonly string[];
  readonly manifestHash: string;
  readonly toolCatalogHash: string;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly provider: string;
  readonly model: string;
  readonly epochs: ToolInvocation['epochs'];
  readonly budget: RunBudget;
}

export interface RuntimeCommandBinding {
  readonly threadId: string;
  readonly runId: string;
  readonly generation: string;
  readonly epochs: ToolInvocation['epochs'];
}

export interface BackendClientOptions {
  backendUrl: string;
  timeoutMs: number;
  sessionVault: SessionVault;
  fetcher?: typeof fetch;
  clientName?: string;
}

export interface MessageRequest {
  threadId: string;
  content: string;
  clientIntent?: string;
  routingMode: RoutingMode;
  provider?: string;
  model?: string;
  modelDisplayName?: string;
  researchMode?: ResearchMode;
  fileIds?: string[];
}

export interface CompareRequest {
  threadId?: string;
  content: string;
  models: { provider: string; model: string }[];
  judgeEnabled?: boolean;
  judgeModel?: string | null;
  fileIds?: string[];
  researchMode?: ResearchMode;
}
