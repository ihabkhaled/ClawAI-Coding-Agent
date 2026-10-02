import { RuntimeHttpError } from '../headless/runtime-http-error';

import { splitCatalog } from './deferred-tools';
import { DEFAULT_DEFERRED_TOOLS } from './deferred-tools.constants';

import type { RuntimeTransportPort } from './agent-sdk.types';
import type { DeferredCatalog } from './deferred-tools.types';

/**
 * The deferral this run will use, or undefined for a whole catalog: the option
 * is off, the transport cannot load a definition mid-run, or nothing offered is
 * deferrable.
 */
export function deferralFor(
  definitions: readonly unknown[],
  option: boolean | readonly string[] | undefined,
  transport: RuntimeTransportPort,
): DeferredCatalog | undefined {
  if (option === undefined || option === false || transport.loadTools === undefined)
    return undefined;
  const catalog = splitCatalog(definitions, option === true ? DEFAULT_DEFERRED_TOOLS : option);
  return catalog.deferred.length === 0 ? undefined : catalog;
}

/** Whether the backend refused the start as invalid: one that predates deferral rejects `deferred`. */
function isValidationRefusal(error: unknown): boolean {
  return error instanceof RuntimeHttpError && error.status === 400;
}

/**
 * Starts the run with stubs, and once with the whole catalog when the backend
 * rejects them. A refused start stores nothing, so the same idempotency key is
 * safe to send again. Returns whether the stubs were accepted.
 */
export async function startRunWithDeferral(
  start: (definitions: readonly unknown[]) => Promise<{ runId: string; generation: string }>,
  catalog: DeferredCatalog | undefined,
  whole: readonly unknown[],
): Promise<{ started: { runId: string; generation: string }; deferred: boolean }> {
  if (catalog === undefined) return { started: await start(whole), deferred: false };
  try {
    return { started: await start(catalog.wire), deferred: true };
  } catch (error) {
    if (!isValidationRefusal(error)) throw error;
    return { started: await start(whole), deferred: false };
  }
}
