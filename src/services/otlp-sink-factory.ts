import { parseOtlpEndpoint } from '../core/otlp-export';
import { OtlpObservabilitySink } from '../infrastructure/otlp-observability-sink';

import { startTelemetryHeaders } from './telemetry-headers-command';

import type { RuntimeConfiguration } from './configuration-service';
import type { ObservabilitySinkPort } from './observability-service';
import type { TelemetryHeaderContext } from './telemetry-header-store.types';
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
 *
 * Headers come from SecretStorage, not settings: the store is started here,
 * before the endpoint check, so an old `clawAI.telemetryHeaders` value is moved
 * out of settings even when no endpoint is configured.
 */
export function otlpSink(
  configuration: RuntimeConfiguration,
  logger: OutputLogger,
  version: string,
  context: TelemetryHeaderContext,
): ObservabilitySinkPort | undefined {
  const headers = startTelemetryHeaders(context, () => configuration.telemetryHeaders, logger);
  const configured = configuration.telemetryEndpoint.trim();
  if (configured.length === 0) return undefined;
  const endpoint = parseOtlpEndpoint(configured, headers.headers);
  if (endpoint === undefined) {
    logger.warn(
      'ClawAI telemetry endpoint was ignored: it must be an https URL, or http only on this machine, and must not carry credentials.',
    );
    return undefined;
  }
  return new OtlpObservabilitySink(endpoint, version, logger);
}
