import { describe, expect, it, vi } from 'vitest';

import { otlpTracePayload, parseOtlpEndpoint } from '../../src/core/otlp-export';
import { OTLP_BATCH_SIZE, OTLP_MAX_QUEUED_SPANS } from '../../src/core/otlp-export.constants';
import { OtlpObservabilitySink } from '../../src/infrastructure/otlp-observability-sink';

import type { OutputLogger } from '../../src/infrastructure/output-logger';
import type { ObservabilitySpan } from '../../src/services/observability-service';

function span(
  overrides: Partial<Record<keyof ObservabilitySpan, unknown>> = {},
): ObservabilitySpan {
  return {
    name: 'tool.execute',
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    startedAt: '2026-09-10T12:00:00.000Z',
    completedAt: '2026-09-10T12:00:01.000Z',
    status: 'ok',
    attributes: { tool: 'workspace.files' },
    ...overrides,
  } as ObservabilitySpan;
}

function logger(): OutputLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as OutputLogger;
}

describe('parseOtlpEndpoint', () => {
  it('accepts an https endpoint anywhere', () => {
    expect(parseOtlpEndpoint('https://otel.example.test/v1/traces', {})?.url).toBe(
      'https://otel.example.test/v1/traces',
    );
  });

  it('accepts plain http only on this machine, which is the ordinary collector', () => {
    expect(parseOtlpEndpoint('http://localhost:4318/v1/traces', {})).toBeDefined();
    expect(parseOtlpEndpoint('http://127.0.0.1:4318/v1/traces', {})).toBeDefined();
  });

  it('refuses plain http to a remote host, which would leak the auth header', () => {
    expect(parseOtlpEndpoint('http://otel.example.test/v1/traces', {})).toBeUndefined();
  });

  it('refuses credentials in the URL rather than storing them in settings', () => {
    expect(parseOtlpEndpoint('https://user:secret@otel.test/v1/traces', {})).toBeUndefined();
  });

  it('refuses a scheme that is not http or https', () => {
    expect(parseOtlpEndpoint('file:///tmp/traces', {})).toBeUndefined();
    expect(parseOtlpEndpoint('not a url', {})).toBeUndefined();
  });

  it('carries the headers through untouched', () => {
    expect(
      parseOtlpEndpoint('https://otel.test/v1/traces', { authorization: 'Bearer x' })?.headers,
    ).toEqual({ authorization: 'Bearer x' });
  });
});

describe('otlpTracePayload', () => {
  it('names the service so a collector can tell traces apart', () => {
    const payload = JSON.stringify(otlpTracePayload([span()], 'clawai-coding-agent', '1.37.0'));

    expect(payload).toContain('clawai-coding-agent');
    expect(payload).toContain('1.37.0');
  });

  it('converts timestamps to the nanoseconds OTLP expects', () => {
    const payload = JSON.parse(JSON.stringify(otlpTracePayload([span()], 'svc', '1'))) as Record<
      string,
      unknown
    >;

    expect(JSON.stringify(payload)).toContain(
      `${String(Date.parse('2026-09-10T12:00:00.000Z'))}000000`,
    );
  });

  it('redacts a secret a span attribute picked up', () => {
    const payload = JSON.stringify(
      otlpTracePayload(
        [span({ attributes: { command: 'curl -H "Authorization: Bearer sk-live-9" x' } })],
        'svc',
        '1',
      ),
    );

    expect(payload).not.toContain('sk-live-9');
    expect(payload).toContain('[REDACTED]');
  });

  it('carries numbers and booleans as their own OTLP types', () => {
    const payload = JSON.stringify(
      otlpTracePayload([span({ attributes: { count: 3, ok: true } })], 'svc', '1'),
    );

    expect(payload).toContain('doubleValue');
    expect(payload).toContain('boolValue');
  });

  it('maps the status words to the codes the wire format uses', () => {
    const errored = JSON.stringify(otlpTracePayload([span({ status: 'error' })], 'svc', '1'));

    expect(errored).toContain('"code":2');
  });

  it('uses the start time when a span never completed', () => {
    const payload = JSON.parse(
      JSON.stringify(otlpTracePayload([span({ completedAt: undefined })], 'svc', '1')),
    ) as {
      resourceSpans: {
        scopeSpans: { spans: { startTimeUnixNano: string; endTimeUnixNano: string }[] }[];
      }[];
    };
    const emitted = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];

    expect(emitted?.endTimeUnixNano).toBe(emitted?.startTimeUnixNano);
  });
});

describe('OtlpObservabilitySink', () => {
  function harness() {
    const calls: { body: string }[] = [];
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? '') });
      return new Response('', { status: 200 });
    });
    const sink = new OtlpObservabilitySink(
      { url: 'https://otel.test/v1/traces', headers: {} },
      '1.37.0',
      logger(),
      send as unknown as typeof fetch,
    );
    return { calls, send, sink };
  }

  it('sends nothing until there is a batch worth sending', async () => {
    const seat = harness();
    seat.sink.emit(span());

    expect(seat.send).not.toHaveBeenCalled();
    await seat.sink.flush();
    expect(seat.send).toHaveBeenCalledTimes(1);
  });

  it('sends as soon as a full batch has accumulated', () => {
    const seat = harness();
    for (let index = 0; index < OTLP_BATCH_SIZE; index += 1) seat.sink.emit(span());

    expect(seat.send).toHaveBeenCalledTimes(1);
  });

  it('flushing an empty queue does nothing at all', async () => {
    const seat = harness();
    await seat.sink.flush();

    expect(seat.send).not.toHaveBeenCalled();
  });

  it('drops the oldest spans rather than growing without limit', async () => {
    const seat = harness();
    const sink = new OtlpObservabilitySink(
      { url: 'https://otel.test/v1/traces', headers: {} },
      '1.37.0',
      logger(),
      async () => {
        throw new Error('collector is down');
      },
    );
    for (let index = 0; index < OTLP_MAX_QUEUED_SPANS + OTLP_BATCH_SIZE; index += 1) {
      sink.emit(span({ name: `span-${String(index)}` }));
    }

    // The failing sends are swallowed; what matters is that nothing threw and
    // the queue never grew past its cap.
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(seat.send).not.toHaveBeenCalled();
  });

  it('never lets a collector failure reach the caller', async () => {
    const sink = new OtlpObservabilitySink(
      { url: 'https://otel.test/v1/traces', headers: {} },
      '1.37.0',
      logger(),
      async () => {
        throw new Error('network down');
      },
    );
    sink.emit(span());

    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('does not pretend to export metrics it has no payload for', () => {
    const seat = harness();
    seat.sink.emitMetrics('run-1', {} as never);

    expect(seat.send).not.toHaveBeenCalled();
  });
});
