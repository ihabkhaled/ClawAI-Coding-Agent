import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { HeadlessRunRequest } from '../../src/headless/headless-transport.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';

/** What a scripted tool call gave back. */
export interface CallOutcome {
  readonly ok: boolean;
  readonly structured: Record<string, unknown>;
  readonly message: string;
}

/** What a script can do: call tools, say something, and see the tools the run was offered. */
export interface ScriptApi {
  readonly prompt: string;
  readonly request: HeadlessRunRequest;
  readonly signal: AbortSignal;
  call(tool: string, operation: string, args?: Record<string, unknown>): Promise<CallOutcome>;
  say(text: string): void;
}

/** A model's behaviour for one run, written as straight-line code. Throwing fails the run. */
export type Script = (api: ScriptApi) => Promise<void>;

export interface TeamTransport {
  readonly transport: RuntimeTransportPort;
  /** Every run request, in the order the runs started. */
  readonly starts: HeadlessRunRequest[];
  /** What scripts threw: an assertion in a script shows up here and not as a mystery failed run. */
  readonly errors: string[];
}

interface Session {
  readonly queue: (HeadlessStreamEvent | 'end')[];
  wake: (() => void) | undefined;
  answer: ((outcome: CallOutcome) => void) | undefined;
  readonly abort: AbortController;
}

function outcomeOf(result: unknown): CallOutcome {
  const body = (result ?? {}) as {
    status?: string;
    structured?: Record<string, unknown>;
    error?: { message?: string };
  };
  return {
    ok: body.status === 'succeeded',
    structured: body.structured ?? {},
    message: body.error?.message ?? '',
  };
}

/**
 * A transport whose runs are played by scripts chosen from the run's prompt, so
 * a lead and several children can run at once without their scripts being
 * matched by the order they happen to start in.
 */
export function teamTransport(choose: (prompt: string) => Script): TeamTransport {
  const starts: HeadlessRunRequest[] = [];
  const errors: string[] = [];
  const sessions = new Map<string, Session>();
  let counter = 0;
  const push = (session: Session, event: HeadlessStreamEvent | 'end'): void => {
    session.queue.push(event);
    session.wake?.();
  };
  return {
    starts,
    errors,
    transport: {
      signIn: () => Promise.resolve('token'),
      createThread: () => {
        counter += 1;
        return Promise.resolve(`thread-${String(counter)}`);
      },
      startRun: (_token, request) => {
        starts.push(request);
        counter += 1;
        const runId = `run-${String(counter)}`;
        const session: Session = {
          queue: [],
          wake: undefined,
          answer: undefined,
          abort: new AbortController(),
        };
        sessions.set(runId, session);
        const api: ScriptApi = {
          prompt: request.prompt,
          request,
          signal: session.abort.signal,
          call: (tool, operation, args = {}) =>
            new Promise((resolve) => {
              session.answer = resolve;
              push(session, {
                type: 'tool.requested',
                payload: {
                  invocationId: `i-${String(counter)}-${String(session.queue.length)}`,
                  toolName: tool,
                  operation,
                  invocation: { arguments: args },
                },
              });
            }),
          say: (text) => {
            push(session, { type: 'model.delta', payload: { text } });
          },
        };
        void choose(request.prompt)(api).then(
          () => {
            push(session, { type: 'run.completed' });
            push(session, 'end');
          },
          (error: unknown) => {
            errors.push(error instanceof Error ? error.message : String(error));
            push(session, {
              type: 'run.failed',
              payload: { code: 'SCRIPT', message: error instanceof Error ? error.message : 'x' },
            });
            push(session, 'end');
          },
        );
        return Promise.resolve({ runId, generation: 'gen-1' });
      },
      submitResult: (_token, run, _epochs, result) => {
        const session = sessions.get(run.runId);
        const answer = session?.answer;
        if (session !== undefined) session.answer = undefined;
        answer?.(outcomeOf(result));
        return Promise.resolve({});
      },
      events: async function* events(_token, run, signal) {
        const session = sessions.get(run.runId);
        if (session === undefined) return;
        signal?.addEventListener('abort', () => {
          session.abort.abort();
          push(session, 'end');
        });
        for (;;) {
          const next = session.queue.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              session.wake = resolve;
            });
            session.wake = undefined;
            continue;
          }
          if (next === 'end') return;
          yield next;
        }
      },
    },
  };
}

/** Resolves after `ms` or when `signal` aborts, so a scripted child can "work" and still be cancelled. */
export function nap(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
