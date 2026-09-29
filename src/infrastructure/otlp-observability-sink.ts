import { otlpTracePayload } from '../core/otlp-export';
import {
  OTLP_BATCH_SIZE,
  OTLP_FLUSH_INTERVAL_MS,
  OTLP_MAX_QUEUED_RUNS,
  OTLP_MAX_QUEUED_SPANS,
} from '../core/otlp-export.constants';
import { otlpMetricsPayload, otlpMetricsUrl } from '../core/otlp-metrics';

import { postOtlp } from './otlp-post';

import type { OutputLogger } from './output-logger';
import type { EvidenceBundle } from '../core/evidence-bundle';
import type { OtlpEndpoint } from '../core/otlp-export.types';
import type { RunUsage } from '../core/run-telemetry.types';
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
  private usages: RunUsage[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dropped = 0;

  constructor(
    private readonly endpoint: OtlpEndpoint,
    private readonly serviceVersion: string,
    private readonly logger: OutputLogger,
    private readonly send: typeof fetch = fetch,
    private readonly sleep?: (milliseconds: number) => Promise<void>,
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
   * One finished run's counts, exported as OTLP metrics on the next flush.
   *
   * Queued beside the spans and flushed with them, so an idle extension stays
   * silent and a run's metrics leave at the same moment its spans do.
   */
  emitUsage(usage: RunUsage): void {
    if (this.usages.length >= OTLP_MAX_QUEUED_RUNS) this.usages.shift();
    this.usages.push(usage);
    this.schedule();
  }

  /**
   * The evidence-bundle metrics are not exported: run counts go through
   * `emitUsage`, and resource peaks such as memory and CPU describe the
   * developer's machine rather than the run, which is not what a team
   * dashboard should be counting.
   */
  emitMetrics(_runId: string, _metrics: EvidenceBundle['metrics']): void {
    return undefined;
  }

  async flush(): Promise<void> {
    this.cancelTimer();
    await Promise.all([this.flushSpans(), this.flushUsage()]);
  }

  private async flushSpans(): Promise<void> {
    const batch = this.queue;
    if (batch.length === 0) return;
    this.queue = [];
    if (this.dropped > 0) {
      this.logger.warn('ClawAI telemetry dropped spans while the collector was unreachable.', {
        dropped: this.dropped,
      });
      this.dropped = 0;
    }
    const body = JSON.stringify(
      otlpTracePayload(batch, 'clawai-coding-agent', this.serviceVersion),
    );
    await postOtlp(this.send, this.endpoint, this.endpoint.url, body, this.logger, this.sleep);
  }

  /**
   * Metrics go to the traces URL's `/v1/metrics` sibling. An endpoint with a
   * vendor path gets no metrics rather than a guess.
   */
  private async flushUsage(): Promise<void> {
    const batch = this.usages;
    if (batch.length === 0) return;
    this.usages = [];
    const url = otlpMetricsUrl(this.endpoint.url);
    if (url === undefined) return;
    const body = JSON.stringify(
      otlpMetricsPayload(batch, 'clawai-coding-agent', this.serviceVersion),
    );
    await postOtlp(this.send, this.endpoint, url, body, this.logger, this.sleep);
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
