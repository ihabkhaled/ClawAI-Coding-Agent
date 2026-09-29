import { describe, expect, it, vi } from 'vitest';

import { otlpId, otlpTracePayload } from '../../src/core/otlp-export';
import { OTLP_MAX_ATTEMPTS, OTLP_MAX_QUEUED_RUNS } from '../../src/core/otlp-export.constants';
import { otlpMetricsPayload, otlpMetricsUrl } from '../../src/core/otlp-metrics';
import { RunTelemetryRecorder } from '../../src/core/run-telemetry';
import { OtlpObservabilitySink } from '../../src/infrastructure/otlp-observability-sink';
import { postOtlp } from '../../src/infrastructure/otlp-post';
import { LocalObservabilityService } from '../../src/services/observability-service';

import type { RunUsage } from '../../src/core/run-telemetry.types';
import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { OutputLogger } from '../../src/infrastructure/output-logger';

function event(type: string, payload: Record<string, unknown>, timestamp: string): RuntimeEvent {
  return { type, payload, timestamp } as unknown as RuntimeEvent;
}

function logger(): OutputLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as OutputLogger;
}

const noWait = async (): Promise<void> => undefined;

const usage: RunUsage = {
  runId: 'req-1',
  status: 'ok',
  startedAt: '2026-09-29T10:00:00.000Z',
  completedAt: '2026-09-29T10:00:02.500Z',
  toolCalls: 3,
  toolFailures: 1,
  inputTokens: 1200,
  outputTokens: 300,
  costMicros: 4200,
  toolsByName: { 'workspace.files': 2, 'workspace.git': 1 },
};

describe('RunTelemetryRecorder', () => {
  it('turns a tool call into a span carrying names and outcome, never arguments', () => {
    const recorder = new RunTelemetryRecorder('req-1', 'span:run');
    expect(
      recorder.observe(
        event(
          'tool.requested',
          {
            invocationId: 'inv-00001',
            toolName: 'workspace.files',
            operation: 'read',
            invocation: { arguments: { path: '.env', token: 'Bearer secret' } },
          },
          '2026-09-29T10:00:00.000Z',
        ),
      ),
    ).toBeUndefined();
    recorder.observe(
      event('tool.started', { invocationId: 'inv-00001' }, '2026-09-29T10:00:00.100Z'),
    );
    const span = recorder.observe(
      event(
        'tool.completed',
        { invocationId: 'inv-00001', status: 'denied' },
        '2026-09-29T10:00:00.400Z',
      ),
    );
    expect(span).toEqual({
      name: 'runtime.v2.tool',
      traceId: 'req-1',
      spanId: 'span:inv-00001',
      parentSpanId: 'span:run',
      startedAt: '2026-09-29T10:00:00.100Z',
      completedAt: '2026-09-29T10:00:00.400Z',
      status: 'error',
      attributes: { 'tool.name': 'workspace.files', 'tool.operation': 'read', outcome: 'denied' },
    });
    expect(JSON.stringify(span)).not.toContain('secret');
  });

  it('adds up tokens and reports cost only when the backend sent one', () => {
    const recorder = new RunTelemetryRecorder('req-1', 'span:run');
    recorder.observe(event('model.completed', { inputTokens: 10, outputTokens: 4 }, 't'));
    recorder.observe(event('model.completed', { inputTokens: -3, outputTokens: 'x' }, 't'));
    expect(recorder.usage('req-1', 'ok', 'a', 'b')).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      toolCalls: 0,
    });
    expect(recorder.usage('req-1', 'ok', 'a', 'b')).not.toHaveProperty('costMicros');
    recorder.observe(event('run.completed', { costMicros: 900.7 }, 't'));
    expect(recorder.usage('req-1', 'ok', 'a', 'b').costMicros).toBe(900);
  });

  it('counts calls per tool and ignores a completion it never saw requested', () => {
    const recorder = new RunTelemetryRecorder('req-1', 'span:run');
    recorder.observe(event('tool.requested', { invocationId: 'inv-00001' }, 't'));
    recorder.observe(event('tool.completed', { invocationId: 'inv-00009', status: 'failed' }, 't'));
    const ok = recorder.observe(
      event('tool.completed', { invocationId: 'inv-00001', status: 'succeeded' }, 't'),
    );
    expect(ok?.status).toBe('ok');
    expect(recorder.usage('r', 'error', 'a', 'b')).toMatchObject({
      toolCalls: 1,
      toolFailures: 0,
      toolsByName: { unknown: 1 },
      status: 'error',
    });
  });
});

describe('otlpId', () => {
  it('keeps a valid hex id and hashes anything else to the length OTLP requires', () => {
    expect(otlpId('0123456789ABCDEF', 16)).toBe('0123456789abcdef');
    expect(otlpId('span:abc', 16)).toMatch(/^[0-9a-f]{16}$/u);
    expect(otlpId('request-1', 32)).toMatch(/^[0-9a-f]{32}$/u);
    expect(otlpId('span:abc', 16)).toBe(otlpId('span:abc', 16));
  });

  it('keeps a tool span linked to its run span after conversion', () => {
    const payload = otlpTracePayload(
      [
        {
          name: 'runtime.v2.tool',
          traceId: 'req-1',
          spanId: 'span:inv',
          parentSpanId: 'span:run',
          startedAt: 'x',
          status: 'ok',
          attributes: {},
        },
      ],
      'svc',
      '1',
    );
    const text = JSON.stringify(payload);
    expect(text).toContain(`"parentSpanId":"${otlpId('span:run', 16)}"`);
    expect(text).toContain(`"traceId":"${otlpId('req-1', 32)}"`);
  });
});

describe('otlpMetricsPayload', () => {
  it('derives the metrics URL only from a standard traces path', () => {
    expect(otlpMetricsUrl('https://otel.test/v1/traces')).toBe('https://otel.test/v1/metrics');
    expect(otlpMetricsUrl('http://localhost:4318/otlp/v1/traces?x=1')).toBe(
      'http://localhost:4318/otlp/v1/metrics?x=1',
    );
    expect(otlpMetricsUrl('https://vendor.test/ingest')).toBeUndefined();
  });

  it('encodes monotonic delta integer sums, one point per run', () => {
    const unpriced: RunUsage = {
      runId: usage.runId,
      status: usage.status,
      startedAt: usage.startedAt,
      completedAt: usage.completedAt,
      toolCalls: usage.toolCalls,
      toolFailures: usage.toolFailures,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      toolsByName: usage.toolsByName,
    };
    const payload = otlpMetricsPayload([usage, unpriced], 'svc', '2.0');
    const [resource] = payload.resourceMetrics as {
      scopeMetrics: { metrics: { name: string; unit: string; sum: Record<string, unknown> }[] }[];
    }[];
    const metrics = resource?.scopeMetrics[0]?.metrics ?? [];
    const byName = new Map(metrics.map((metric) => [metric.name, metric]));
    expect([...byName.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
      'clawai.cost',
      'clawai.run.duration',
      'clawai.runs',
      'clawai.tokens',
      'clawai.tool.calls',
      'clawai.tool.failures',
    ]);
    expect(byName.get('clawai.runs')?.sum).toMatchObject({
      aggregationTemporality: 1,
      isMonotonic: true,
    });
    const duration = byName.get('clawai.run.duration')?.sum.dataPoints as { asInt: string }[];
    expect(duration[0]?.asInt).toBe('2500');
    expect((byName.get('clawai.tokens')?.sum.dataPoints as unknown[]).length).toBe(4);
    expect((byName.get('clawai.cost')?.sum.dataPoints as unknown[]).length).toBe(1);
    expect(JSON.stringify(payload)).toContain('"startTimeUnixNano":"1790676000000000000"');
  });

  it('clamps an unparseable duration to zero rather than sending NaN', () => {
    const text = JSON.stringify(otlpMetricsPayload([{ ...usage, completedAt: 'never' }], 's', '1'));
    expect(text).not.toContain('NaN');
  });
});

describe('postOtlp', () => {
  const endpoint = { url: 'https://otel.test/v1/traces', headers: { authorization: 'Bearer k' } };

  it('retries what the specification says to retry, then gives up without throwing', async () => {
    const send = vi.fn(async () => new Response('', { status: 503 }));
    const sleep = vi.fn(noWait);
    const log = logger();
    await expect(
      postOtlp(send as unknown as typeof fetch, endpoint, endpoint.url, '{}', log, sleep),
    ).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(OTLP_MAX_ATTEMPTS);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it('does not retry a request the collector rejected as malformed', async () => {
    const send = vi.fn(async () => new Response('echoed Bearer k', { status: 400 }));
    const log = logger();
    await postOtlp(send, endpoint, endpoint.url, '{}', log, noWait);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('Bearer');
  });

  it('retries a network failure and succeeds', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(
      postOtlp(send as unknown as typeof fetch, endpoint, endpoint.url, '{}', logger(), noWait),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits between attempts by default', async () => {
    vi.useFakeTimers();
    try {
      const send = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));
      const pending = postOtlp(send, endpoint, endpoint.url, '{}', logger());
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OtlpObservabilitySink usage export', () => {
  function seat(url = 'https://otel.test/v1/traces') {
    const calls: { url: string; body: string }[] = [];
    const send = vi.fn(async (target: string, init?: RequestInit) => {
      calls.push({ url: target, body: String(init?.body ?? '') });
      return new Response('', { status: 200 });
    });
    const sink = new OtlpObservabilitySink(
      { url, headers: {} },
      '1.0.0',
      logger(),
      send as unknown as typeof fetch,
      noWait,
    );
    return { calls, sink };
  }

  it('posts run usage to the metrics sibling of the traces endpoint', async () => {
    const { calls, sink } = seat();
    sink.emitUsage(usage);
    await sink.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://otel.test/v1/metrics');
    expect(calls[0]?.body).toContain('clawai.tokens');
    sink.dispose();
  });

  it('sends no metrics to an endpoint whose metrics route it cannot know', async () => {
    const { calls, sink } = seat('https://vendor.test/ingest');
    sink.emitUsage(usage);
    await sink.flush();
    expect(calls).toHaveLength(0);
  });

  it('keeps only the most recent runs during an outage', async () => {
    const { calls, sink } = seat();
    for (let index = 0; index < OTLP_MAX_QUEUED_RUNS + 5; index += 1) {
      sink.emitUsage({ ...usage, runId: `run-${String(index)}` });
    }
    await sink.flush();
    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      resourceMetrics: {
        scopeMetrics: { metrics: { name: string; sum: { dataPoints: unknown[] } }[] }[];
      }[];
    };
    const runs = body.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(
      (metric) => metric.name === 'clawai.runs',
    );
    expect(runs?.sum.dataPoints).toHaveLength(OTLP_MAX_QUEUED_RUNS);
  });
});

describe('LocalObservabilityService usage', () => {
  it('forwards usage only to an approved remote sink that can export it', () => {
    const local = { emit: vi.fn(), emitMetrics: vi.fn() };
    const remote = { emit: vi.fn(), emitMetrics: vi.fn(), emitUsage: vi.fn() };
    const service = new LocalObservabilityService(local, remote);
    service.emitUsage(usage);
    expect(remote.emitUsage).not.toHaveBeenCalled();
    service.setRemoteExport(true, true);
    service.emitUsage(usage);
    expect(remote.emitUsage).toHaveBeenCalledWith(usage);
  });
});
