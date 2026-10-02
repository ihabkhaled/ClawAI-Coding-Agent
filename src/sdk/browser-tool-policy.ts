import { BROWSER_ACTING_OPERATIONS } from './browser-tool.constants';

import type { OperationClassification } from '../core/runtime/runtime-operation-classification';

/**
 * How the editor's policy sees a browser operation.
 *
 * Looking at a page the operator allowed (snapshot, screenshot, console,
 * network, wait, close) reads. `open` loads a page, which reaches the network
 * (R2, read). click, type and press change what a site holds for the visitor
 * and cannot be undone (R2 local-mutation). None is R3: the operator's host
 * list is the boundary for where a page may go, so `autonomous-scoped` lets the
 * run work and `strict` still asks about every acting call.
 */
export function classifyBrowserOperation(operation: string): OperationClassification {
  if (operation === 'open') return { effect: 'read', risk: 'R2', reversible: true };
  if (BROWSER_ACTING_OPERATIONS.includes(operation)) {
    return { effect: 'local-mutation', risk: 'R2', reversible: false };
  }
  return { effect: 'read', risk: 'R0', reversible: true };
}

/** Whether the operation only looks, and so is never put to an approval. */
export function isBrowserObservation(operation: string): boolean {
  return !BROWSER_ACTING_OPERATIONS.includes(operation);
}
