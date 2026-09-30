import type {
  BoundedOutput,
  CommandYieldOutcome,
  CommandYieldRequest,
} from './command-yield.types';
import type { RuntimeToolExecutionOutput } from '../services/runtime-tool-dispatcher';

/**
 * Keep the last `limitBytes` of a log. The tail is what a model needs from a
 * build that is still running: the first lines are banners, the last are
 * where it is now.
 */
export function boundedTail(log: string, limitBytes: number): BoundedOutput {
  const bytes = Buffer.from(log, 'utf8');
  if (bytes.byteLength <= limitBytes) return { output: log, truncated: false };
  return {
    output: bytes.subarray(bytes.byteLength - limitBytes).toString('utf8'),
    truncated: true,
  };
}

/** Resolves when the window elapses or the turn is cancelled, whichever is first. */
function windowOrCancel(
  yieldAfterMs: number,
  signal: AbortSignal | undefined,
  cleanup: { dispose: () => void },
): Promise<CommandYieldOutcome> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve('cancelled');
      return;
    }
    const onAbort = (): void => {
      resolve('cancelled');
    };
    const timer = setTimeout(() => {
      resolve('yielded');
    }, yieldAfterMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    cleanup.dispose = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
  });
}

/**
 * Wait up to `yieldAfterMs` for a supervised command, then answer either way.
 *
 * Tool results are single-shot, so a model cannot watch a command's output
 * while it runs. This is the honest equivalent: a command that finishes inside
 * the window reports like a foreground one; one that does not is left running
 * under the supervisor and the output so far is returned with its receipt, so
 * the model reads the rest with `workspace.process` inspect or waits with join.
 */
export async function awaitOrYield(
  request: CommandYieldRequest,
): Promise<RuntimeToolExecutionOutput> {
  const cleanup = { dispose: (): void => undefined };
  const outcome = await Promise.race([
    request.supervisor.join([request.receipt]).then((): CommandYieldOutcome => 'exited'),
    windowOrCancel(request.yieldAfterMs, request.signal, cleanup),
  ]);
  cleanup.dispose();
  if (outcome === 'cancelled') await request.supervisor.terminate(request.receipt);
  const snapshot = request.supervisor.snapshot(request.receipt);
  const tail = boundedTail(snapshot.log, request.outputLimitBytes);
  const common = {
    receipt: { ...request.receipt },
    output: tail.output,
    truncated: tail.truncated,
    durationMs: Date.now() - request.startedAtMs,
    ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
  };
  if (outcome === 'exited')
    return {
      structured: {
        ...common,
        yielded: false,
        exitCode: snapshot.exitCode,
        signal: snapshot.signal,
      },
    };
  if (outcome === 'cancelled')
    return { structured: { ...common, yielded: false, cancelled: true } };
  return {
    structured: {
      ...common,
      yielded: true,
      background: true,
      yieldAfterMs: request.yieldAfterMs,
      next: 'Still running. Use workspace.process inspect with this receipt to read more output, join to wait for exit, terminate to stop it.',
    },
  };
}
