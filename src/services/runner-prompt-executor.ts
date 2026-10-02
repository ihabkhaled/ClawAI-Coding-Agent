import {
  resolvePromptWorkspace,
  runnerToolDecision,
  splitModelReference,
} from '../core/runner-prompt-policy';
import {
  RUNNER_PROMPT_REFUSED_EXIT_CODE,
  RUNNER_PROMPT_TOOL_CATEGORIES,
} from '../core/runner-prompt-policy.constants';
import { createAgent } from '../sdk/create-agent';

import type { RemotePromptJob } from './remote-command-loop.types';
import type { RunnerPromptExecutorPorts } from './runner-prompt-executor.types';
import type { RemoteCommandResult } from '../backend/agent-remote-client';

/**
 * F099: runs one PROMPT job on this runner through the headless SDK.
 *
 * The job names a repository; it runs only in the open folder of that name.
 * Every tool call passes `runnerToolDecision` first: a read-only call runs
 * unattended only on a runner registered with AUTO_APPROVE_READ_ONLY, and a
 * write or a command always waits for the person here.
 */
export function runnerPromptExecutor(
  ports: RunnerPromptExecutorPorts,
): (job: RemotePromptJob, signal: AbortSignal) => Promise<RemoteCommandResult> {
  return async (job, signal) => {
    const folder = resolvePromptWorkspace(ports.folders(), job.repoRef);
    if (folder === undefined) {
      return refused(
        job.repoRef === undefined
          ? 'No workspace folder is open on this runner.'
          : `No open workspace folder is named ${job.repoRef}.`,
      );
    }
    const token = await ports.accessToken();
    if (token === undefined) {
      return refused('Sign in to ClawAI on this runner to run prompt jobs.');
    }
    const { provider, model } = splitModelReference(job.model);
    const agent = (ports.createAgent ?? createAgent)({
      auth: { token },
      workspaceRoot: folder.fsPath,
      secretEnvironment: job.secrets,
      backendUrl: ports.backendUrl,
      provider,
      model,
      permissions: {
        allow: RUNNER_PROMPT_TOOL_CATEGORIES,
        approve: (request) =>
          runnerToolDecision(request, ports.policy) === 'auto' ? true : ports.ask(request),
      },
    });
    const result = await agent.run(job.prompt, { signal, title: `Runner job ${job.id}` });
    const failure =
      result.outcome === 'completed'
        ? ''
        : `Run ${result.outcome}${result.error === undefined ? '' : `: ${result.error}`}`;
    return { exitCode: result.exitCode, stdout: result.text, stderr: failure };
  };
}

function refused(reason: string): RemoteCommandResult {
  return { exitCode: RUNNER_PROMPT_REFUSED_EXIT_CODE, stdout: '', stderr: reason };
}
