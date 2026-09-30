import { describe, expect, it, vi } from 'vitest';

import { runnerPromptExecutor } from '../../src/services/runner-prompt-executor';

import type { RunnerApprovalPolicy } from '../../src/core/runner-prompt-policy.types';
import type { AgentConfig, AgentResult } from '../../src/sdk/create-agent.types';
import type { AgentApprovalRequest } from '../../src/sdk/workspace-toolkit.types';
import type { RemotePromptJob } from '../../src/services/remote-command-loop.types';

const job: RemotePromptJob = {
  id: 'job-1',
  prompt: 'Summarise open TODOs',
  model: 'GEMINI/gemini-2.5-flash',
  repoRef: 'claw',
};

const completed: AgentResult = {
  outcome: 'completed',
  exitCode: 0,
  toolCalls: 2,
  deniedCalls: 0,
  text: 'Three TODOs remain.',
};

function setup(
  options: {
    policy?: RunnerApprovalPolicy;
    token?: string | undefined;
    result?: AgentResult;
    ask?: boolean;
  } = {},
) {
  const configs: AgentConfig[] = [];
  const run = vi.fn(() => Promise.resolve(options.result ?? completed));
  const ask = vi.fn((_request: AgentApprovalRequest) => Promise.resolve(options.ask ?? false));
  const execute = runnerPromptExecutor({
    folders: () => [
      { name: 'Claw', fsPath: '/work/Claw' },
      { name: 'docs', fsPath: '/work/docs' },
    ],
    accessToken: () => Promise.resolve('token' in options ? options.token : 'user-token'),
    backendUrl: 'https://claw.local/api/v1',
    policy: options.policy ?? 'ASK',
    ask,
    createAgent: (config) => {
      configs.push(config);
      return { run };
    },
  });
  return { execute, configs, run, ask };
}

function call(category: AgentApprovalRequest['category']): AgentApprovalRequest {
  return { toolName: 'workspace.file', operation: 'read', arguments: {}, category };
}

async function approve(config: AgentConfig | undefined, request: AgentApprovalRequest) {
  const decide = config?.permissions?.approve;
  if (decide === undefined) throw new Error('no approval hook');
  return decide(request);
}

describe('runnerPromptExecutor', () => {
  it('runs the prompt in the named folder with the job model and reports the answer', async () => {
    const { execute, configs, run } = setup();
    const result = await execute(job, new AbortController().signal);
    expect(configs[0]).toMatchObject({
      auth: { token: 'user-token' },
      workspaceRoot: '/work/Claw',
      backendUrl: 'https://claw.local/api/v1',
      provider: 'GEMINI',
      model: 'gemini-2.5-flash',
    });
    expect(configs[0]?.permissions?.allow).toEqual(['read', 'git', 'write', 'command']);
    expect(run).toHaveBeenCalledWith('Summarise open TODOs', expect.any(Object));
    expect(result).toEqual({ exitCode: 0, stdout: 'Three TODOs remain.', stderr: '' });
  });

  it('refuses when no open folder matches the repository, without running', async () => {
    const { execute, run } = setup();
    const result = await execute({ ...job, repoRef: 'elsewhere' }, new AbortController().signal);
    expect(run).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain('elsewhere');
  });

  it('refuses when signed out, without running', async () => {
    const { execute, run } = setup({ token: undefined });
    const result = await execute(job, new AbortController().signal);
    expect(run).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(126);
  });

  it('under ASK, even a read waits for the person at the runner', async () => {
    const { execute, configs, ask } = setup({ policy: 'ASK', ask: false });
    await execute(job, new AbortController().signal);
    expect(await approve(configs[0], call('read'))).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('under AUTO_APPROVE_READ_ONLY, reads run and writes/commands still ask', async () => {
    const { execute, configs, ask } = setup({ policy: 'AUTO_APPROVE_READ_ONLY', ask: false });
    await execute(job, new AbortController().signal);
    expect(await approve(configs[0], call('read'))).toBe(true);
    expect(await approve(configs[0], call('git'))).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(await approve(configs[0], call('write'))).toBe(false);
    expect(await approve(configs[0], call('command'))).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('reports a run that did not complete with its outcome and exit code', async () => {
    const { execute } = setup({
      result: { ...completed, outcome: 'blocked', exitCode: 4, text: '', error: 'denied' },
    });
    const result = await execute(job, new AbortController().signal);
    expect(result).toEqual({ exitCode: 4, stdout: '', stderr: 'Run blocked: denied' });
  });
});
