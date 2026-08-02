import type { EvidenceBundle } from '../core/evidence-bundle';

export interface ObservabilitySpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: 'unset' | 'ok' | 'error';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface ObservabilitySinkPort {
  emit(span: ObservabilitySpan): void;
  emitMetrics(runId: string, metrics: EvidenceBundle['metrics']): void;
}

export class LocalObservabilityService {
  private remoteEnabled = false;

  constructor(
    private readonly local: ObservabilitySinkPort,
    private readonly remote?: ObservabilitySinkPort,
  ) {}

  setRemoteExport(enabled: boolean, explicitlyApproved: boolean): void {
    if (enabled && (!explicitlyApproved || this.remote === undefined)) {
      throw new Error('Remote telemetry requires an available sink and explicit approval');
    }
    this.remoteEnabled = enabled;
  }

  emit(span: ObservabilitySpan): void {
    this.local.emit(span);
    if (this.remoteEnabled) this.remote?.emit(span);
  }

  emitMetrics(runId: string, metrics: EvidenceBundle['metrics']): void {
    this.local.emitMetrics(runId, metrics);
    if (this.remoteEnabled) this.remote?.emitMetrics(runId, metrics);
  }
}
