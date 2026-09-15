import { parseOtlpEndpoint } from '../core/otlp-export';
import { OtlpObservabilitySink } from '../infrastructure/otlp-observability-sink';

import type { RuntimeConfiguration } from './configuration-service';
import type { ObservabilitySinkPort } from './observability-service';
import type { OutputLogger } from '../infrastructure/output-logger';

/**
 * The remote span sink, when the workspace has asked for one.
 *
 * An empty endpoint means no sink, which means `setRemoteExport` is never
 * enabled and nothing leaves the machine. Configuring an endpoint is the
 * approval: there is no default collector to opt out of, because telemetry that
 * turns itself on is the thing people rightly object to.
 *
 * A configured endpoint that fails validation is logged rather than ignored. A
 * plain `http:` URL to a remote host is a reasonable thing to type and a bad
 * thing to honour, and silently sending nothing would leave someone waiting for
 * traces that were never going to arrive.
 */
export function otlpSink(
  configuration: RuntimeConfiguration,
  logger: OutputLogger,
  version: string,
): ObservabilitySinkPort | undefined {
  const configured = configuration.telemetryEndpoint.trim();
  if (configured.length === 0) return undefined;
  const endpoint = parseOtlpEndpoint(configured, configuration.telemetryHeaders);
  if (endpoint === undefined) {
    logger.warn(
      'ClawAI telemetry endpoint was ignored: it must be an https URL, or http only on this machine, and must not carry credentials.',
    );
    return undefined;
  }
  return new OtlpObservabilitySink(endpoint, version, logger);
}
