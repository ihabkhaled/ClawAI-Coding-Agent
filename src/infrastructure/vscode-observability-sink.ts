import type { EvidenceBundle } from '../core/evidence-bundle';
import type { OutputLogger } from './output-logger';
import type { ObservabilitySinkPort, ObservabilitySpan } from '../services/observability-service';

export class VscodeObservabilitySink implements ObservabilitySinkPort {
  constructor(private readonly logger: OutputLogger) {}

  emit(span: ObservabilitySpan): void {
    this.logger.info('Runtime observability span', {
      name: span.name,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      startedAt: span.startedAt,
      completedAt: span.completedAt,
      status: span.status,
      attributes: span.attributes,
    });
  }

  emitMetrics(runId: string, metrics: EvidenceBundle['metrics']): void {
    this.logger.info('Runtime evidence metrics', { runId, metrics });
  }
}
