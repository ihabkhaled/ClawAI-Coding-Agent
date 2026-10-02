import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { remoteCommandSchema } from '../../src/backend/agent-remote-client';
import { createCommandTool } from '../../src/sdk/command-tool';
import { redactingCommandTool, secretCommandRuntime } from '../../src/sdk/command-tool-secrets';
import { RemoteCommandLoop } from '../../src/services/remote-command-loop';
import { runnerPromptExecutor } from '../../src/services/runner-prompt-executor';

import { cleanUpWorkspaces, nodeScript, runCommand, workspace } from './sdk-command-tool.helpers';

import type { RemoteCommand, RemoteCommandResult } from '../../src/backend/agent-remote-client';
import type { AgentConfig, AgentResult } from '../../src/sdk/create-agent.types';
import type { RemotePromptJob } from '../../src/services/remote-command-loop.types';

cleanUpWorkspaces();

const VALUE = 'zq-routine-value-7731';
const OPTIONS = {
  pollIntervalMs: 10,
  maxBackoffMs: 40,
  maxConsecutiveFailures: 2,
  heartbeatEveryPolls: 1,
};

function loopWith(
  job: RemoteCommand,
  runPrompt: (job: RemotePromptJob) => Promise<RemoteCommandResult>,
  reports: string[] = [],
) {
  const completed: RemoteCommandResult[] = [];
  const holder: { loop?: RemoteCommandLoop } = {};
  let fetched = false;
  const loop = new RemoteCommandLoop(
    {
      source: {
        fetch: () => {
          const batch = fetched ? [] : [job];
          fetched = true;
          return Promise.resolve(batch);
        },
        heartbeat: () => Promise.resolve(),
        complete: (_id, result) => {
          completed.push(result);
          return Promise.resolve();
        },
      },
      approve: () => Promise.resolve(true),
      execute: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      workspaceRoot: () => path.resolve('/workspace/project'),
      sleep: () => {
        holder.loop?.stop();
        return Promise.resolve();
      },
      report: (message) => reports.push(message),
      runPrompt,
    },
    OPTIONS,
  );
  holder.loop = loop;
  return { start: () => loop.start(), completed };
}

const promptJob = (extra: Partial<RemoteCommand> = {}): RemoteCommand => ({
  id: 'j1',
  kind: 'PROMPT',
  command: 'deploy the site',
  secrets: [{ name: 'DEPLOY_KEY', value: VALUE }],
  ...extra,
});

const ok = (stdout = ''): Promise<RemoteCommandResult> =>
  Promise.resolve({ exitCode: 0, stdout, stderr: '' });

describe('claimed job secrets: wire shape', () => {
  it('accepts a job with secrets and a job from an older server without them', () => {
    expect(remoteCommandSchema.parse(promptJob()).secrets).toEqual([
      { name: 'DEPLOY_KEY', value: VALUE },
    ]);
    expect(
      remoteCommandSchema.parse({ id: 'a', command: 'x', kind: 'PROMPT' }).secrets,
    ).toBeUndefined();
  });
});

describe('claimed job secrets: the loop', () => {
  it('hands the validated map to the prompt runner and never to the prompt text', async () => {
    const seen: RemotePromptJob[] = [];
    const { start } = loopWith(promptJob(), (job) => {
      seen.push(job);
      return ok('ok');
    });
    await start();
    expect(seen[0]?.secrets).toEqual({ DEPLOY_KEY: VALUE });
    expect(seen[0]?.prompt).toBe('deploy the site');
    expect(seen[0]?.prompt).not.toContain(VALUE);
  });

  it('redacts the value from the reported stdout and stderr', async () => {
    const { start, completed } = loopWith(promptJob(), () =>
      Promise.resolve({ exitCode: 1, stdout: `token=${VALUE}`, stderr: `failed with ${VALUE}` }),
    );
    await start();
    expect(JSON.stringify(completed)).not.toContain(VALUE);
    expect(completed[0]).toMatchObject({
      stdout: 'token=[REDACTED]',
      stderr: 'failed with [REDACTED]',
    });
  });

  it('redacts a value that an error message carried', async () => {
    const { start, completed } = loopWith(promptJob(), () =>
      Promise.reject(new Error(`boom ${VALUE}`)),
    );
    await start();
    expect(completed[0]?.stderr).toBe('boom [REDACTED]');
  });

  it('never writes the value to the report line', async () => {
    const reports: string[] = [];
    const { start } = loopWith(promptJob(), () => ok(VALUE), reports);
    await start();
    expect(reports.join('\n')).not.toContain(VALUE);
  });

  it('runs an older server job with no secrets exactly as before', async () => {
    const seen: RemotePromptJob[] = [];
    const { start, completed } = loopWith({ id: 'j2', kind: 'PROMPT', command: 'hello' }, (job) => {
      seen.push(job);
      return ok('hi');
    });
    await start();
    expect(seen[0]?.secrets).toEqual({});
    expect(completed[0]).toEqual({ exitCode: 0, stdout: 'hi', stderr: '' });
  });

  it('drops a secret named like a loader variable instead of exporting it', async () => {
    const seen: RemotePromptJob[] = [];
    const { start } = loopWith(
      promptJob({ secrets: [{ name: 'NODE_OPTIONS', value: '--require /tmp/x.js' }] }),
      (job) => {
        seen.push(job);
        return ok();
      },
    );
    await start();
    expect(seen[0]?.secrets).toEqual({});
  });
});

describe('claimed job secrets: the executor', () => {
  it('gives the agent the secrets as its environment and not as part of the prompt', async () => {
    const configs: AgentConfig[] = [];
    const finished: AgentResult = {
      outcome: 'completed',
      exitCode: 0,
      toolCalls: 0,
      deniedCalls: 0,
      text: 'done',
    };
    const run = vi.fn(() => Promise.resolve(finished));
    const execute = runnerPromptExecutor({
      folders: () => [{ name: 'Claw', fsPath: '/work/Claw' }],
      accessToken: () => Promise.resolve('user-token'),
      backendUrl: 'https://claw.local/api/v1',
      policy: 'ASK',
      ask: () => Promise.resolve(false),
      createAgent: (config) => {
        configs.push(config);
        return { run };
      },
    });
    await execute(
      { id: 'j', prompt: 'p', model: undefined, repoRef: 'claw', secrets: { DEPLOY_KEY: VALUE } },
      new AbortController().signal,
    );
    expect(configs[0]?.secretEnvironment).toEqual({ DEPLOY_KEY: VALUE });
    expect(JSON.stringify(run.mock.calls)).not.toContain(VALUE);
    expect(JSON.stringify({ ...configs[0], secretEnvironment: undefined })).not.toContain(VALUE);
  });
});

describe('claimed job secrets: the command tool child', () => {
  const print =
    'process.stdout.write(process.env.DEPLOY_KEY === undefined ? "unset" : process.env.DEPLOY_KEY)';
  const length = 'process.stdout.write(String((process.env.DEPLOY_KEY ?? "").length))';

  it('puts the secret in the child environment', async () => {
    const tool = createCommandTool(secretCommandRuntime({ DEPLOY_KEY: VALUE }));
    const result = await runCommand(tool, workspace(), nodeScript(length));
    expect(result.stdout).toBe(String(VALUE.length));
  });

  it('does not put it in the environment of an ordinary agent', async () => {
    const result = await runCommand(createCommandTool(), workspace(), nodeScript(print));
    expect(result.stdout).toBe('unset');
  });

  it('scrubs the value when the child prints it, so the model never reads it', async () => {
    const env = { DEPLOY_KEY: VALUE };
    const tool = redactingCommandTool(createCommandTool(secretCommandRuntime(env)), env);
    const result = await runCommand(tool, workspace(), nodeScript(print));
    expect(result.stdout).toBe('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain(VALUE);
  });

  it('scrubs it from stderr of a failing child as well', async () => {
    const env = { DEPLOY_KEY: VALUE };
    const tool = redactingCommandTool(createCommandTool(secretCommandRuntime(env)), env);
    const result = await runCommand(
      tool,
      workspace(),
      nodeScript('console.error("bad " + process.env.DEPLOY_KEY); process.exit(2)'),
    );
    expect(result.exitCode).toBe(2);
    expect(JSON.stringify(result)).not.toContain(VALUE);
  });

  it('does not let a secret named CI override the fixed non-interactive settings', async () => {
    const tool = createCommandTool(secretCommandRuntime({ CI: 'definitely-not-true' }));
    const result = await runCommand(
      tool,
      workspace(),
      nodeScript('process.stdout.write(process.env.CI ?? "")'),
    );
    expect(result.stdout).not.toBe('definitely-not-true');
  });
});
