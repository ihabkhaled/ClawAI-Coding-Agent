import { THREAD_ORIGIN_BY_SOURCE } from './thread-source.constants';

import type { ThreadOrigin, ThreadSource, ThreadSurface } from './thread-source.types';

/** The origin a surface must send when it creates a thread. */
export function threadOriginForSource(source: ThreadSource): ThreadOrigin {
  return THREAD_ORIGIN_BY_SOURCE[source];
}

/**
 * The surface a stored thread came from, given its `origin` field.
 *
 * An absent origin is WEB because that is the backend default for a thread
 * created without one — which is exactly what an older CLI build did.
 */
export function threadSurfaceOf(origin: unknown): ThreadSurface {
  return origin === 'CODING_AGENT' ? 'agent' : 'web';
}
