import { RuntimeHttpError } from '../../src/headless/runtime-http-error';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { HeadlessRunRequest } from '../../src/headless/headless-transport.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';

/** A read of a file that exists in any workspace these tests run in. */
export const readCall = (index: number): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: `i-${String(index)}`,
    toolName: 'workspace.file',
    operation: 'read',
    invocation: { arguments: { path: 'package.json' } },
  },
});

export const BUDGET_FAILED: HeadlessStreamEvent = {
  type: 'run.failed',
  payload: {
    code: 'RUNTIME_BUDGET_EXHAUSTED',
    message: 'The run used all of its allowed tool calls.',
  },
};

export const COMPLETED: HeadlessStreamEvent = { type: 'run.completed' };

export interface ScriptedRuntime {
  readonly transport: RuntimeTransportPort;
  readonly starts: HeadlessRunRequest[];
  readonly submitted: unknown[];
}

/**
 * A transport whose Nth run plays the Nth script, and which reports every run
 * request it was sent. The entry `'refuse-409'` stands for
 * the request for a tool call and answers its result with a 409, as the runtime
 * does once a run's budget is gone.
 */
export function scriptedRuns(
  scripts: readonly (readonly (HeadlessStreamEvent | 'refuse-409')[])[],
): ScriptedRuntime {
  const starts: HeadlessRunRequest[] = [];
  const submitted: unknown[] = [];
  return {
    starts,
    submitted,
    transport: {
      signIn: () => Promise.resolve('t'),
      createThread: () => Promise.resolve('thread-1'),
      startRun: (_token, request) => {
        starts.push(request);
        return Promise.resolve({ runId: `run-${String(starts.length)}`, generation: 'gen-1' });
      },
      submitResult: (_token, _run, _epochs, result) => {
        const script = scripts[starts.length - 1] ?? [];
        if (script.includes('refuse-409')) {
          return Promise.reject(
            new RuntimeHttpError(
              '/results',
              409,
              '{"code":"RUNTIME_BUDGET_EXHAUSTED","message":"The run used all of its allowed tool calls before finishing."}',
            ),
          );
        }
        submitted.push(result);
        return Promise.resolve({});
      },
      events: async function* events() {
        const script = scripts[starts.length - 1] ?? [COMPLETED];
        for (const entry of script) {
          if (entry !== 'refuse-409') yield await Promise.resolve(entry);
          else yield await Promise.resolve(readCall(99));
        }
      },
    },
  };
}
