import { redactText } from './redaction';

import type { OtlpEndpoint, OtlpTracePayload } from './otlp-export.types';
import type { ObservabilitySpan } from '../services/observability-service';

const MAX_ATTRIBUTE_LENGTH = 1_000;
const MAX_ATTRIBUTES_PER_SPAN = 40;

/** OTLP status codes: unset, ok, error. Numbers, because the wire format is. */
const STATUS_CODES: Readonly<Record<ObservabilitySpan['status'], number>> = {
  unset: 0,
  ok: 1,
  error: 2,
};

/**
 * Whether this endpoint may be posted to.
 *
 * HTTPS everywhere except loopback, and that exception is the point rather than
 * a hole. A collector running on the developer's own machine is the ordinary
 * setup and has no certificate; a collector anywhere else is reached across a
 * network that will happily read a plaintext bearer token out of the headers.
 *
 * Credentials in the URL are refused for the same reason they are refused in
 * the browser allow list: a password in a settings file is a password in a
 * backup, a screen share and a bug report.
 */
export function parseOtlpEndpoint(
  url: string,
  headers: Readonly<Record<string, string>>,
): OtlpEndpoint | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) return undefined;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return { url: parsed.toString(), headers };
}

/**
 * An RFC 3339 timestamp as the nanoseconds OTLP expects.
 *
 * Millisecond precision multiplied out, which is what the source has. Claiming
 * nanosecond precision the extension never measured would make two spans a
 * microsecond apart look ordered when they were not.
 */
function nanoseconds(timestamp: string | undefined): string {
  const millis = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(millis) ? `${String(millis)}000000` : '0';
}

/**
 * Span attributes, redacted and bounded.
 *
 * Spans carry tool arguments, paths and command lines, which is exactly the
 * material a secret ends up in. Redaction happens here rather than at the
 * emitter because this is the boundary that leaves the machine, and a sink that
 * only writes to an output channel has different stakes from one that posts to
 * a vendor.
 */
function attributes(span: ObservabilitySpan): unknown[] {
  return Object.entries(span.attributes)
    .slice(0, MAX_ATTRIBUTES_PER_SPAN)
    .map(([key, value]) => ({
      key,
      value:
        typeof value === 'string'
          ? { stringValue: redactText(value).slice(0, MAX_ATTRIBUTE_LENGTH) }
          : typeof value === 'number'
            ? { doubleValue: value }
            : { boolValue: value },
    }));
}

/**
 * The OTLP/HTTP JSON body for a batch of spans.
 *
 * Written by hand rather than pulled from a dependency. The JSON encoding is a
 * stable, published shape and the alternative is the OpenTelemetry SDK, which
 * brings a tracer, a context manager and an async-hooks dependency into an
 * extension host that already has its own span model. What is needed here is a
 * serializer, not a tracing framework.
 */
export function otlpTracePayload(
  spans: readonly ObservabilitySpan[],
  serviceName: string,
  serviceVersion: string,
): OtlpTracePayload {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'service.version', value: { stringValue: serviceVersion } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'clawai.runtime' },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              kind: 1,
              startTimeUnixNano: nanoseconds(span.startedAt),
              endTimeUnixNano: nanoseconds(span.completedAt ?? span.startedAt),
              attributes: attributes(span),
              status: { code: STATUS_CODES[span.status] },
            })),
          },
        ],
      },
    ],
  };
}
