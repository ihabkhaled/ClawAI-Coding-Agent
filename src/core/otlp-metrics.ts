import type { OtlpMetricsPayload, OtlpMetricSeries } from './otlp-export.types';
import type { RunUsage } from './run-telemetry.types';

/** OTLP AggregationTemporality: each point counts only its own run. */
const DELTA = 1;

function nanoseconds(timestamp: string): string {
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? `${String(millis)}000000` : '0';
}

function attribute(key: string, value: string): unknown {
  return { key, value: { stringValue: value } };
}

/**
 * The traces URL's metrics sibling, or nothing when there is no safe guess.
 *
 * OTLP/HTTP puts both signals under one base, `/v1/traces` and `/v1/metrics`.
 * A URL that does not end in `/v1/traces` is a vendor path this cannot reason
 * about, and posting metrics to a traces route would be rejected at best.
 */
export function otlpMetricsUrl(tracesUrl: string): string | undefined {
  const url = new URL(tracesUrl);
  if (!url.pathname.endsWith('/v1/traces')) return undefined;
  url.pathname = `${url.pathname.slice(0, -'/v1/traces'.length)}/v1/metrics`;
  return url.toString();
}

function seriesFor(usages: readonly RunUsage[]): Map<string, OtlpMetricSeries> {
  const series = new Map<string, OtlpMetricSeries>();
  const add = (
    name: string,
    unit: string,
    description: string,
    usage: RunUsage,
    value: number,
    attributes: readonly unknown[] = [],
  ): void => {
    const entry = series.get(name) ?? { unit, description, points: [] };
    entry.points.push({
      attributes,
      startTimeUnixNano: nanoseconds(usage.startedAt),
      timeUnixNano: nanoseconds(usage.completedAt),
      asInt: String(Math.max(0, Math.floor(value))),
    });
    series.set(name, entry);
  };
  for (const usage of usages) {
    const duration = Date.parse(usage.completedAt) - Date.parse(usage.startedAt);
    add('clawai.runs', '{run}', 'Finished agent runs', usage, 1, [
      attribute('status', usage.status),
    ]);
    add(
      'clawai.run.duration',
      'ms',
      'Wall time of finished runs',
      usage,
      Number.isFinite(duration) ? duration : 0,
    );
    add('clawai.tokens', '{token}', 'Model tokens', usage, usage.inputTokens, [
      attribute('direction', 'input'),
    ]);
    add('clawai.tokens', '{token}', 'Model tokens', usage, usage.outputTokens, [
      attribute('direction', 'output'),
    ]);
    add('clawai.tool.failures', '{call}', 'Failed tool calls', usage, usage.toolFailures);
    for (const [tool, calls] of Object.entries(usage.toolsByName)) {
      add('clawai.tool.calls', '{call}', 'Tool calls', usage, calls, [
        attribute('tool.name', tool),
      ]);
    }
    if (usage.costMicros !== undefined) {
      add('clawai.cost', '{microUSD}', 'Reported run cost', usage, usage.costMicros);
    }
  }
  return series;
}

/**
 * The OTLP/HTTP JSON metrics body for a batch of finished runs.
 *
 * Monotonic delta sums, one data point per run. Delta rather than cumulative
 * because the extension host restarts with every window reload, and a
 * cumulative counter that resets to zero reads to a backend as a counter reset
 * it has to guess about; a delta per run is exactly what happened.
 *
 * Integers only. Cost is micro-USD, the same unit the billing ledger uses, so
 * no float ever represents money on this path.
 */
export function otlpMetricsPayload(
  usages: readonly RunUsage[],
  serviceName: string,
  serviceVersion: string,
): OtlpMetricsPayload {
  const metrics = [...seriesFor(usages)].map(([name, entry]) => ({
    name,
    unit: entry.unit,
    description: entry.description,
    sum: { aggregationTemporality: DELTA, isMonotonic: true, dataPoints: entry.points },
  }));
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            attribute('service.name', serviceName),
            attribute('service.version', serviceVersion),
          ],
        },
        scopeMetrics: [{ scope: { name: 'clawai.runtime' }, metrics }],
      },
    ],
  };
}
