import { randomUUID } from 'node:crypto';

const FLAT_OPERATIONS: ReadonlySet<string> = new Set([
  'artifact',
  'copy',
  'create',
  'delete',
  'mkdir',
  'patch',
  'rename',
  'update',
]);

/**
 * The transaction a write call asks for, in whichever of two shapes it arrived.
 *
 * The documented shape wraps one operation in a `transaction` envelope. Models
 * very often send the operation's own fields at the top level instead —
 * `{ rootKey, path }` for a `mkdir` — because that is what the tool's name and
 * the sentence "mkdir takes path only" suggest. Refusing it with "expected
 * object, received undefined" taught the model nothing about which object, and
 * a live run repeated the same call three times before giving up on creating a
 * folder. The flat form carries exactly the same information, so it is wrapped
 * into the same single-operation envelope and then validated by the same strict
 * schema as any other call: nothing is accepted that the envelope would refuse.
 */
export function transactionCandidate(operation: string, args: Record<string, unknown>): unknown {
  if (args.transaction !== undefined) return args.transaction;
  if (!FLAT_OPERATIONS.has(operation) || typeof args.path !== 'string') return undefined;
  const fields = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'transaction'));
  return {
    transactionId: `flat-${randomUUID()}`,
    summary: `${operation} ${args.path}`,
    operations: [{ kind: operation, ...fields }],
  };
}

/** What to tell a model whose write call named no operation fields at all. */
export function missingTransactionMessage(operation: string): string {
  return (
    `workspace.files ${operation} needs its arguments. Send either ` +
    `{"transaction":{"transactionId":"<id>","summary":"<why>","operations":[{"kind":"${operation}",` +
    '"rootKey":"workspace-1","path":"<path>"}]}} or the operation\'s own fields at the top level, ' +
    `for example {"rootKey":"workspace-1","path":"<path>"} for mkdir.`
  );
}

/** True when a read-style failure means the path is simply not there. */
export function isMissingPathError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const record = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return code === 'ENOENT' || code === 'FileNotFound' || /ENOENT|FileNotFound/u.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withIdentity(
  transaction: Record<string, unknown>,
  operation: string,
): Record<string, unknown> {
  const id = typeof transaction.transactionId === 'string' ? transaction.transactionId : '';
  const summary = typeof transaction.summary === 'string' ? transaction.summary.trim() : '';
  return {
    ...transaction,
    transactionId: id.length >= 8 ? id : `${id === '' ? 'tx' : id}-${randomUUID().slice(0, 8)}`,
    summary: summary === '' ? `${operation} via workspace.files` : summary,
  };
}

/**
 * Fills in what a model leaves out and the answer is not in doubt.
 *
 * A `create` has no earlier version to compare against, so its `beforeHash` can
 * only be null; requiring the model to write that out cost whole turns, and one
 * model repeated the omission until its budget ran out. A transaction id is a
 * label, not a secret, so a short one is lengthened and a missing summary is
 * described. Nothing that guards against a stale write is relaxed: `update`,
 * `patch`, `delete`, `rename` and `copy` still must name the hash they read.
 */
export function withTransactionDefaults(candidate: unknown, operation: string): unknown {
  if (!isRecord(candidate)) return candidate;
  const named = withIdentity(candidate, operation);
  const operations = named.operations;
  if (!Array.isArray(operations)) return named;
  return {
    ...named,
    operations: operations.map((item: unknown) =>
      isRecord(item) && item.kind === 'create' && item.beforeHash === undefined
        ? { ...item, beforeHash: null }
        : item,
    ),
  };
}
