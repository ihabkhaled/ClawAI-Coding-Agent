import { otlpTracePayload } from '../core/otlp-export';
import {
  OTLP_BATCH_SIZE,
  OTLP_FLUSH_INTERVAL_MS,
  OTLP_MAX_QUEUED_SPANS,
  OTLP_TIMEOUT_MS,
} from '../core/otlp-export.constants';

import type { OutputLogger } from './output-logger';
import type { EvidenceBundle } from '../core/evidence-bundle';
import type { OtlpEndpoint } from '../core/otlp-export.types';
import type { ObservabilitySinkPort, ObservabilitySpan } from '../services/observability-service';

/**
 * Sends spans to an OTLP collector, in batches, and never at the cost of a run.
 *
 * `setRemoteExport` has existed since remote telemetry was designed and has had
 * no production caller: spans terminated in the VS Code output channel. This is
 * the sink it was waiting for.
 *
 * Three rules make it safe to leave on. Failures are swallowed after one log
 * line, because a collector being down must never turn into a failed run. The
 * queue drops its oldest spans past a small cap, because a telemetry buffer
 * that grows without limit turns an outage into a memory leak. And every export
 * is bounded by a timeout, because a collector that accepts a connection and
 * never answers would otherwise hold a promise for the life of the window.
 */
export class OtlpObservabilitySink implements ObservabilitySinkPort {
  private queue: ObservabilitySpan[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dropped = 0;

  constructor(
    private readonly endpoint: OtlpEndpoint,
    private readonly serviceVersion: string,
    private readonly logger: OutputLogger,
    private readonly send: typeof fetch = fetch,
  ) {}

  emit(span: ObservabilitySpan): void {
    if (this.queue.length >= OTLP_MAX_QUEUED_SPANS) {
      // The recent spans are the ones worth keeping during an outage: they
      // describe what is happening now, not what happened before the collector
      // went away.
      this.queue.shift();
      this.dropped += 1;
    }
    this.queue.push(span);
    if (this.queue.length >= OTLP_BATCH_SIZE) {
      void this.flush();
      return;
    }
    this.schedule();
  }

  /**
   * Metrics are not exported yet, and saying so is better than pretending.
   *
   * A metrics payload is a different OTLP shape with its own aggregation
   * temporality rules, and emitting spans shaped like metrics would produce a
   * dashboard that looks right and counts nothing.
   */
  emitMetrics(_runId: string, _metrics: EvidenceBundle['metrics']): void {
    return undefined;
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    const batch = this.queue;
    if (batch.length === 0) return;
    this.queue = [];
    if (this.dropped > 0) {
      this.logger.warn('ClawAI telemetry dropped spans while the collector was unreachable.', {
        dropped: this.dropped,
      });
      this.dropped = 0;
    }
    try {
      const response = await this.send(this.endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.endpoint.headers },
        body: JSON.stringify(otlpTracePayload(batch, 'clawai-coding-agent', this.serviceVersion)),
        signal: AbortSignal.timeout(OTLP_TIMEOUT_MS),
      });
      if (!response.ok) {
        // The status, never the body. A collector's error body can echo the
        // request, and the request carries the headers.
        this.logger.warn('ClawAI telemetry export was refused.', { status: response.status });
      }
    } catch (error: unknown) {
      this.logger.warn('ClawAI telemetry export failed.', error);
    }
  }

  dispose(): void {
    this.cancelTimer();
    void this.flush();
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, OTLP_FLUSH_INTERVAL_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
