import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTeamFixtures,
  gitWorkspace,
  leftoverWorktrees,
  makeDir,
  must,
  readIn,
  readJson,
  reportOf,
  runPlan,
  scratch,
} from '../helpers/orchestrate-fixture';
import { agent, plan } from '../helpers/orchestrate-plans';
import { nap } from '../helpers/team-transport';

import type { ScriptApi } from '../helpers/team-transport';

afterEach(cleanTeamFixtures);

const FILE = 'workspace.file';

/** A check command that passes when the file exists (no shell: the quotes group one word). */
const exists = (file: string): string => `node -e "require('fs').accessSync('${file}')"`;

/** A scripted agent that writes one file and reports. */
const writer =
  (file: string, content: string, report = 'done') =>
  async (api: ScriptApi) => {
    must(await api.call(FILE, 'create', { path: file, content }));
    api.say(report);
  };

/** The check the integration gate runs: both modules exist and say what they should. */
const CHECK_SCRIPT = [
  "const fs = require('node:fs');",
  "const a = fs.readFileSync('mod-a/index.js', 'utf8');",
  "const b = fs.readFileSync('mod-b/index.js', 'utf8');",
  "if (!a.includes('A') || !b.includes('B')) process.exit(1);",
].join('\n');

function twoModules(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return plan(
    [
      {
        id: 'modules',
        agents: [
          agent({
            name: 'mod-a',
            writeScope: ['mod-a/**'],
            doneChecks: [{ label: 'a-exists', command: exists('mod-a/index.js') }],
          }),
          agent({ name: 'mod-b', writeScope: ['mod-b/**'] }),
        ],
      },
      {
        id: 'integration',
        dependsOn: ['modules'],
        agents: [agent({ name: 'wire', tools: ['read'] })],
        gate: { doneChecks: [{ label: 'combined', command: 'node check.js' }] },
      },
    ],
    extra,
  );
}

function workspaceWithCheck(): string {
  const workspace = scratch('claw-orch-ws-');
  writeFileSync(path.join(workspace, 'check.js'), CHECK_SCRIPT);
  return workspace;
}

describe('orchestrate: a real run through scripted agents', () => {
  it('builds two modules in parallel, passes the gate, writes both report files', async () => {
    const workspace = workspaceWithCheck();
    const run = await runPlan(
      twoModules(),
      {
        'mod-a': writer('mod-a/index.js', 'module.exports = "A";\n', 'a built'),
        'mod-b': writer('mod-b/index.js', 'module.exports = "B";\n', 'b built'),
        wire: async (api) => {
          api.say('wired');
        },
      },
      { workspace },
    );
    const report = reportOf(run);
    expect(report.status).toBe('passed');
    expect(readIn(workspace, 'mod-a/index.js')).toContain('"A"');
    const modules = report.stages[0];
    expect(modules?.agents.map((a) => [a.name, a.state])).toEqual([
      ['mod-a', 'completed'],
      ['mod-b', 'completed'],
    ]);
    expect(modules?.agents[0]?.result?.files).toEqual(['mod-a/index.js']);
    expect(modules?.agents[0]?.result?.summary).toBe('a built');
    expect(modules?.agents[0]?.result?.checks[0]).toMatchObject({ label: 'a-exists', ok: true });
    expect(report.stages[1]?.gate).toMatchObject({ passed: true });
    expect(report.totals.files).toBe(2);

    expect(report.directory).toBeDefined();
  });

  it('writes report.json and report.md under the state directory', async () => {
    const workspace = workspaceWithCheck();
    const run = await runPlan(
      twoModules(),
      {
        'mod-a': writer('mod-a/index.js', 'A'),
        'mod-b': writer('mod-b/index.js', 'B'),
      },
      { workspace },
    );
    const report = reportOf(run);
    const directory = report.directory ?? '';
    expect(directory.startsWith(path.join(run.state, 'orchestrate'))).toBe(true);
    const json = readJson(path.join(directory, 'report.json'));
    expect(json.status).toBe('passed');
    const markdown = readFileSync(path.join(directory, 'report.md'), 'utf8');
    expect(markdown).toContain('# Orchestration demo: passed');
    expect(markdown).toContain('## Stage modules: passed');
    expect(markdown).toContain('**mod-a**: completed');
    expect(markdown).toContain('Waves: modules -> integration');
  });

  it('gives each child its narrowed grant, scope, budget, task context and no agents tool grant', async () => {
    const prompts: string[] = [];
    const operations: Record<string, string[]> = {};
    const run = await runPlan(twoModules(), {
      'mod-a': async (api) => {
        prompts.push(api.prompt);
        operations['mod-a'] = api.request.toolDefinitions.map((d) =>
          String((d as { name?: string }).name),
        );
      },
    });
    expect(reportOf(run).status).toBe('failed');
    expect(prompts[0]).toContain('You may change only: mod-a/**.');
    expect(prompts[0]).toContain(
      'Plan "demo", stage "modules". Goal of the whole plan: build a thing',
    );
    expect(operations['mod-a']).not.toContain('http.request');
    expect(operations['mod-a']).not.toContain('workspace.shell');
  });

  it('fails a stage whose gate fails and skips the stage after it, with the check output tail in the report', async () => {
    const workspace = workspaceWithCheck();
    const raw = plan(
      [
        {
          id: 'build',
          agents: [agent({ name: 'builder', writeScope: ['mod-a/**'] })],
          gate: { doneChecks: [{ label: 'combined', command: 'node check.js' }] },
        },
        { id: 'after', dependsOn: ['build'], agents: [agent({ name: 'later', tools: ['read'] })] },
      ],
      { onFailure: 'continue' },
    );
    const run = await runPlan(raw, { builder: writer('mod-a/index.js', 'x\n') }, { workspace });
    const report = reportOf(run);
    expect(report.status).toBe('failed');
    expect(report.stages.map((s) => s.status)).toEqual(['failed', 'skipped']);
    expect(report.stages[1]?.reason).toBe('Skipped: stage "build" failed.');
    expect(report.stages[0]?.gate?.passed).toBe(false);
    const markdown = readFileSync(path.join(report.directory ?? '', 'report.md'), 'utf8');
    expect(markdown).toContain('FAIL `combined`');
    expect(run.starts.some((start) => start.prompt.includes('sub-agent "later"'))).toBe(false);
  });

  it("re-verifies an agent's checks in the real workspace after it finishes", async () => {
    const raw = plan([
      {
        id: 's',
        agents: [
          agent({
            name: 'liar',
            writeScope: ['out/**'],
            doneChecks: [{ label: 'file-exists', command: exists('out/x.txt') }],
          }),
        ],
      },
    ]);
    const run = await runPlan(raw, {
      liar: async (api) => {
        api.say('I made out/x.txt, honest');
      },
    });
    const report = reportOf(run);
    expect(report.status).toBe('failed');
    const result = report.stages[0]?.agents[0]?.result;
    expect(result?.state).toBe('failed');
    expect(result?.checks[0]).toMatchObject({ label: 'file-exists', ok: false });
  });

  it('refuses a plan with overlapping write scopes before starting anything', async () => {
    const raw = plan([
      {
        id: 's',
        agents: [
          agent({ name: 'one', writeScope: ['src/**'] }),
          agent({ name: 'two', writeScope: ['src/lib/**'] }),
        ],
      },
    ]);
    const run = await runPlan(raw, {});
    expect(run.outcome.ok).toBe(false);
    expect(!run.outcome.ok && run.outcome.problems.join('\n')).toContain('src/** and src/lib/**');
    expect(run.starts).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it('refuses a workspace that does not exist', async () => {
    const run = await runPlan(twoModules({ workspace: 'no-such-folder' }), {});
    expect(!run.outcome.ok && run.outcome.problems[0]).toContain('does not exist');
  });

  it('streams orchestrate events for the stages and agents', async () => {
    const workspace = workspaceWithCheck();
    const run = await runPlan(
      twoModules(),
      {
        'mod-a': writer('mod-a/index.js', 'A'),
        'mod-b': writer('mod-b/index.js', 'B'),
      },
      { workspace },
    );
    const types = run.events.map((event) => event.type);
    expect(types[0]).toBe('orchestrate.started');
    expect(types).toContain('orchestrate.gate');
    expect(types.at(-1)).toBe('orchestrate.finished');
    expect(types.filter((type) => type === 'orchestrate.stage.finished')).toHaveLength(2);
    expect(JSON.stringify(run.events)).not.toContain('"token"');
  });
});

describe('orchestrate: sub-agent tool options', () => {
  const httpPlan = (hosts: string[]): Record<string, unknown> =>
    plan([
      {
        id: 's',
        agents: [
          agent({
            name: 'caller',
            tools: ['read', 'http'],
            http: { allowHosts: hosts },
            writeScope: undefined,
          }),
          agent({ name: 'plain', tools: ['read'] }),
        ],
      },
    ]);

  it('gives only the agent that names hosts an http tool, limited to those hosts', async () => {
    const offered: Record<string, string[]> = {};
    const record = (name: string) => async (api: ScriptApi) => {
      offered[name] = api.request.toolDefinitions.map((d) => String((d as { name?: string }).name));
    };
    const run = await runPlan(
      httpPlan(['api.example.com']),
      { caller: record('caller'), plain: record('plain') },
      {
        ceiling: { allow: ['read', 'http'], httpAllowHosts: ['*.example.com'] },
        config: { permissions: { allow: ['read', 'http'], httpAllowHosts: ['*.example.com'] } },
      },
    );
    expect(reportOf(run).status).toBe('passed');
    expect(offered.caller).toContain('http.request');
    expect(offered.plain).not.toContain('http.request');
  });

  it('refuses hosts the run does not allow, before anything starts', async () => {
    const run = await runPlan(
      httpPlan(['evil.com']),
      {},
      { ceiling: { allow: ['read', 'http'], httpAllowHosts: ['*.example.com'] } },
    );
    expect(!run.outcome.ok && run.outcome.problems.join('')).toContain('not inside the hosts');
    expect(run.starts).toEqual([]);
  });

  it('gives the shell only to the agent that asks, with both switches on', async () => {
    const offered: Record<string, string[]> = {};
    const raw = plan([
      {
        id: 's',
        agents: [
          agent({ name: 'runner', tools: ['read'], shell: true }),
          agent({ name: 'plain', tools: ['read'] }),
        ],
      },
    ]);
    const record = (name: string) => async (api: ScriptApi) => {
      offered[name] = api.request.toolDefinitions.map((d) => String((d as { name?: string }).name));
    };
    const run = await runPlan(
      raw,
      { runner: record('runner'), plain: record('plain') },
      { ceiling: { allow: ['read', 'shell'], shell: true } },
    );
    expect(reportOf(run).status).toBe('passed');
    expect(offered.runner).toContain('workspace.shell');
    expect(offered.plain).not.toContain('workspace.shell');
  });

  it('refuses shell when the run has not switched it on', async () => {
    const raw = plan([
      { id: 's', agents: [agent({ name: 'runner', tools: ['read'], shell: true })] },
    ]);
    const run = await runPlan(raw, {});
    expect(!run.outcome.ok && run.outcome.problems.join('')).toContain('does not grant shell');
  });

  it('puts a child shell script to the parent approver: denied with none', async () => {
    const raw = plan([
      { id: 's', agents: [agent({ name: 'runner', tools: ['read'], shell: true })] },
    ]);
    let message = '';
    const run = await runPlan(
      raw,
      {
        runner: async (api) => {
          const out = await api.call('workspace.shell', 'run', { script: 'echo hi' });
          message = out.ok ? 'ran' : out.message;
        },
      },
      { ceiling: { allow: ['read', 'shell'], shell: true } },
    );
    expect(reportOf(run).stages[0]?.agents[0]?.state).toBe('completed');
    expect(message).not.toBe('ran');
  });
});

describe('orchestrate: cancel, timeout and worktree clean-up', () => {
  it('cancelling the run cancels the children and returns a cancelled report', async () => {
    const controller = new AbortController();
    const raw = plan([{ id: 's', agents: [agent({ name: 'slow', writeScope: ['s/**'] })] }]);
    const pending = runPlan(
      raw,
      {
        slow: async (api) => {
          await nap(30_000, api.signal);
        },
      },
      { signal: controller.signal },
    );
    setTimeout(() => {
      controller.abort();
    }, 300);
    const run = await pending;
    const report = reportOf(run);
    expect(report.status).toBe('cancelled');
    expect(report.stages[0]?.agents[0]?.state).toBe('cancelled');
  }, 30_000);

  it('the plan timeout ends the run as timeout', async () => {
    const raw = plan([{ id: 's', agents: [agent({ name: 'slow', writeScope: ['s/**'] })] }], {
      timeoutSec: 10,
    });
    const run = await runPlan(raw, {
      slow: async (api) => {
        await nap(60_000, api.signal);
      },
    });
    const report = reportOf(run);
    expect(report.status).toBe('timeout');
    expect(report.stages[0]?.agents[0]?.state).toBe('cancelled');
  }, 60_000);

  it('merges a worktree agent back and removes its checkout', async () => {
    const workspace = gitWorkspace();
    const raw = plan([
      { id: 's', agents: [agent({ name: 'iso', writeScope: ['lib/**'], isolation: 'worktree' })] },
    ]);
    const run = await runPlan(raw, { iso: writer('lib/x.txt', 'from worktree\n') }, { workspace });
    const report = reportOf(run);
    expect(report.status).toBe('passed');
    expect(readIn(workspace, 'lib/x.txt')).toBe('from worktree\n');
    expect(report.stages[0]?.agents[0]?.result?.files).toEqual(['lib/x.txt']);
    expect(leftoverWorktrees(run.state)).toEqual([]);
  }, 60_000);

  it('removes the worktree when the run is cancelled mid-flight and merges nothing', async () => {
    const workspace = gitWorkspace();
    const controller = new AbortController();
    const raw = plan([
      { id: 's', agents: [agent({ name: 'iso', writeScope: ['lib/**'], isolation: 'worktree' })] },
    ]);
    const pending = runPlan(
      raw,
      {
        iso: async (api) => {
          must(await api.call(FILE, 'create', { path: 'lib/half.txt', content: 'half\n' }));
          await nap(30_000, api.signal);
        },
      },
      { workspace, signal: controller.signal },
    );
    setTimeout(() => {
      controller.abort();
    }, 1_500);
    const run = await pending;
    expect(reportOf(run).status).toBe('cancelled');
    expect(existsSync(path.join(workspace, 'lib', 'half.txt'))).toBe(false);
    expect(leftoverWorktrees(run.state)).toEqual([]);
  }, 60_000);

  it('retries a failed agent in a fresh attempt and reports two attempts', async () => {
    const raw = plan(
      [
        {
          id: 's',
          agents: [
            agent({
              name: 'flaky',
              writeScope: ['f/**'],
              doneChecks: [{ label: 'has-file', command: exists('f/ok.txt') }],
            }),
          ],
        },
      ],
      { onFailure: 'retry:1' },
    );
    let attempts = 0;
    const run = await runPlan(raw, {
      flaky: async (api) => {
        attempts += 1;
        if (attempts === 2)
          must(await api.call(FILE, 'create', { path: 'f/ok.txt', content: 'ok' }));
      },
    });
    const report = reportOf(run);
    expect(attempts).toBe(2);
    expect(report.status).toBe('passed');
    expect(report.stages[0]?.agents[0]?.attempts).toBe(2);
    expect(run.events.some((event) => event.type === 'orchestrate.agent.retrying')).toBe(true);
  }, 60_000);
});

describe('orchestrate: paths on Windows and POSIX', () => {
  it('reports changed files with forward slashes and writes under the state directory', async () => {
    const workspace = scratch('claw-orch-ws-');
    makeDir(workspace, 'deep/er');
    const raw = plan([{ id: 's', agents: [agent({ name: 'w', writeScope: ['deep/**'] })] }]);
    const run = await runPlan(raw, { w: writer('deep/er/file.txt', 'x\n') }, { workspace });
    const report = reportOf(run);
    expect(report.stages[0]?.agents[0]?.result?.files).toEqual(['deep/er/file.txt']);
    expect(report.directory).toBe(path.join(run.state, 'orchestrate', report.runId));
    expect(JSON.stringify(report)).not.toContain('deep\\\\er');
  });

  it('resolves a relative plan workspace against cwd and takes an absolute one as it is', async () => {
    const parent = scratch('claw-orch-ws-');
    makeDir(parent, 'sub');
    const raw = plan([{ id: 's', agents: [agent({ name: 'w', writeScope: ['out/**'] })] }], {
      workspace: 'sub',
    });
    const run = await runPlan(raw, { w: writer('out/a.txt', 'a\n') }, { workspace: parent });
    expect(reportOf(run).status).toBe('passed');
    expect(readIn(path.join(parent, 'sub'), 'out/a.txt')).toBe('a\n');
    const absolute = plan([{ id: 's', agents: [agent({ name: 'w2', writeScope: ['out/**'] })] }], {
      workspace: path.join(parent, 'sub'),
    });
    const second = await runPlan(
      absolute,
      { w2: writer('out/b.txt', 'b\n') },
      { workspace: scratch('claw-orch-elsewhere-') },
    );
    expect(reportOf(second).status).toBe('passed');
    expect(readIn(path.join(parent, 'sub'), 'out/b.txt')).toBe('b\n');
  });

  it('refuses a write scope that escapes the workspace', async () => {
    for (const scope of ['../x/**', 'C:/x/**', '/abs/**']) {
      const raw = plan([{ id: 's', agents: [agent({ name: 'w', writeScope: [scope] })] }]);
      const run = await runPlan(raw, {});
      expect(run.outcome.ok, scope).toBe(false);
    }
  });

  it('reads a Windows-style scope (backslashes) as the same folder for the overlap check', async () => {
    const raw = plan([
      {
        id: 's',
        agents: [
          agent({ name: 'one', writeScope: ['a\\b/**'] }),
          agent({ name: 'two', writeScope: ['a/b/c/**'] }),
        ],
      },
    ]);
    const run = await runPlan(raw, {});
    expect(!run.outcome.ok && run.outcome.problems.join('')).toContain('overlap');
  });
});
