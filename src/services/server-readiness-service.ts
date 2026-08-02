import { z } from 'zod';

import { browserOrigin, isOriginAllowed, type BrowserScope } from '../core/browser-operation';
import { redactText } from '../core/redaction';

const readinessRequestSchema = z
  .object({
    url: z.url().max(4_096),
    attempts: z.number().int().min(1).max(20).default(6),
    intervalMs: z.number().int().min(50).max(30_000).default(500),
    requestTimeoutMs: z.number().int().min(100).max(60_000).default(3_000),
    expectedStatuses: z.array(z.number().int().min(100).max(599)).min(1).max(20).default([200]),
    processSessionId: z.string().min(8).max(200).optional(),
  })
  .strict();

export interface ReadinessProcessPort {
  evidence(
    sessionId: string,
    runId: string,
  ): {
    readonly running: boolean;
    readonly logs: string;
  };
}

export interface ServerReadinessReceipt {
  readonly ready: boolean;
  readonly urlOrigin: string;
  readonly attempts: number;
  readonly status?: number;
  readonly lastError?: string;
  readonly processRunning?: boolean;
  readonly processLogs?: string;
}

export class ServerReadinessService {
  constructor(
    private readonly scope: () => BrowserScope,
    private readonly processes: ReadinessProcessPort,
    private readonly request: typeof fetch = fetch,
  ) {}

  async wait(
    candidate: unknown,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ServerReadinessReceipt> {
    const input = readinessRequestSchema.parse(candidate);
    if (!isOriginAllowed(input.url, this.scope())) {
      throw new Error('Readiness URL is outside the approved browser origins');
    }
    let lastError: string | undefined;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error('Readiness request timed out'));
      }, input.requestTimeoutMs);
      const abort = () => {
        controller.abort(signal?.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const response = await this.request(input.url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'text/plain,application/json;q=0.9' },
        });
        lastStatus = response.status;
        if (input.expectedStatuses.includes(response.status)) {
          return this.receipt(input, runId, attempt, true, response.status);
        }
        lastError = `Unexpected HTTP status ${String(response.status)}`;
      } catch (error) {
        lastError = redactText(error instanceof Error ? error.message : 'Readiness request failed');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
      if (attempt < input.attempts) await this.delay(input.intervalMs, signal);
    }
    return this.receipt(input, runId, input.attempts, false, lastStatus, lastError);
  }

  private receipt(
    input: z.infer<typeof readinessRequestSchema>,
    runId: string,
    attempts: number,
    ready: boolean,
    status?: number,
    lastError?: string,
  ): ServerReadinessReceipt {
    const processEvidence =
      input.processSessionId === undefined
        ? undefined
        : this.processes.evidence(input.processSessionId, runId);
    return {
      ready,
      urlOrigin: browserOrigin(input.url),
      attempts,
      ...(status === undefined ? {} : { status }),
      ...(lastError === undefined ? {} : { lastError }),
      ...(processEvidence === undefined ? {} : { processRunning: processEvidence.running }),
      ...(processEvidence === undefined
        ? {}
        : { processLogs: redactText(processEvidence.logs).slice(-32_768) }),
    };
  }

  private async delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Readiness cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
