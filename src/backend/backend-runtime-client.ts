import {
  runtimeMutationAckSchema,
  runtimeStartAckSchema,
  type RuntimeCommandBinding,
  type RuntimeMutationAck,
  type RuntimeStartAck,
  type RuntimeStartRequest,
} from './backend-client.types';
import { runtimeProtocolWireDescriptorSchema } from './contracts';

import type { RuntimeProtocolWireDescriptor } from '../core/runtime/runtime-negotiation';
import type { ToolResult } from '../core/runtime/runtime-tool-contracts';
import type { z } from 'zod';

type Request = <T>(
  path: string,
  schema: z.ZodType<T>,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
) => Promise<T>;

/**
 * How long a runtime command may take before the client gives up on it.
 *
 * These are not ordinary requests. Posting a tool result hands the run back to
 * the platform, which calls the model and only then answers — so the request is
 * open for as long as the turn takes. The generic request budget is one minute,
 * and the platform's own provider timeout is five, so any turn slower than a
 * minute was aborted from this side while the backend was still working
 * perfectly well: the panel said "ClawAI request timed out." and the run was
 * lost. Observed twice in the final sweep, at 70 s and 110 s. This sits above
 * the provider timeout so the platform's answer — success or its own timeout —
 * is what decides the run.
 */
const RUNTIME_COMMAND_TIMEOUT_MS = 330_000;

export class BackendRuntimeClient {
  constructor(
    private readonly request: Request,
    private readonly openAuthenticatedStream: (
      path: string,
      signal?: AbortSignal,
    ) => Promise<Response>,
  ) {}

  getProtocol(signal?: AbortSignal): Promise<RuntimeProtocolWireDescriptor> {
    return this.request('/agent/runtime/protocol', runtimeProtocolWireDescriptorSchema, {
      ...(signal === undefined ? {} : { signal }),
    });
  }

  start(input: RuntimeStartRequest, signal?: AbortSignal): Promise<RuntimeStartAck> {
    return this.request('/chat-messages/runtime/runs', runtimeStartAckSchema, {
      body: input,
      method: 'POST',
      timeoutMs: RUNTIME_COMMAND_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  submitResult(
    binding: RuntimeCommandBinding,
    idempotencyKey: string,
    result: ToolResult,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.command(
      binding,
      'results',
      {
        generation: binding.generation,
        idempotencyKey,
        epochs: binding.epochs,
        result,
      },
      signal,
    );
  }

  steer(
    binding: RuntimeCommandBinding,
    steering: unknown,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.command(binding, 'steering', { generation: binding.generation, steering }, signal);
  }

  cancel(
    binding: RuntimeCommandBinding,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    return this.command(
      binding,
      'cancel',
      {
        generation: binding.generation,
        idempotencyKey,
        epochs: binding.epochs,
        requestedAt: new Date().toISOString(),
      },
      signal,
    );
  }

  openStream(
    binding: RuntimeCommandBinding,
    after: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const query = new URLSearchParams({
      protocol: 'v2',
      runId: binding.runId,
      generation: binding.generation,
      after: String(after),
    });
    return this.openAuthenticatedStream(
      `/chat-messages/stream/${encodeURIComponent(binding.threadId)}?${query.toString()}`,
      signal,
    );
  }

  private command(
    binding: RuntimeCommandBinding,
    command: 'results' | 'steering' | 'cancel',
    body: unknown,
    signal?: AbortSignal,
  ): Promise<RuntimeMutationAck> {
    const query = new URLSearchParams({ threadId: binding.threadId });
    return this.request(
      `/chat-messages/runtime/runs/${encodeURIComponent(binding.runId)}/${command}?${query.toString()}`,
      runtimeMutationAckSchema,
      {
        body,
        method: 'POST',
        timeoutMs: RUNTIME_COMMAND_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  }
}
