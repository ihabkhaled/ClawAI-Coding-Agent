import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOrchestrateCli } from '../../src/headless/orchestrate-cli';
import { browserHostsProblem, httpHostsProblem } from '../../src/sdk/agent-team-hosts';
import { cleanTeamFixtures, must, scratch } from '../helpers/orchestrate-fixture';
import { agent, diamond, plan } from '../helpers/orchestrate-plans';
import { childName } from '../helpers/team-fixture';
import { teamTransport } from '../helpers/team-transport';

afterEach(cleanTeamFixtures);

interface Captured {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function cli(
  argv: readonly string[],
  files: Record<string, unknown>,
  environment: Record<string, string | undefined> = { CLAW_TOKEN: 't' },
  transport?: ReturnType<typeof teamTransport>['transport'],
): Promise<Captured> {
  const dir = scratch('claw-orch-cli-');
  const state = scratch('claw-orch-cli-state-');
  vi.stubEnv('CLAW_STATE_DIR', state);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(
      path.join(dir, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  let out = '';
  let err = '';
  const code = await runOrchestrateCli(
    argv,
    environment,
    {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
    },
    { cwd: dir, transport, stateDirectory: state },
  );
  return { code, out, err };
}

describe('clawai orchestrate: arguments', () => {
  it('prints usage for --help, exit 0', async () => {
    const run = await cli(['--help'], {});
    expect(run.code).toBe(0);
    expect(run.out).toContain('Usage: clawai orchestrate --plan');
  });

  it.each([
    [[], '--plan <file> is required'],
    [['--plan'], '--plan needs a value'],
    [['--plan', 'p.json', '--bogus'], 'Unknown argument: --bogus'],
    [['--plan', 'p.json', '--allow-tools', 'nope'], 'Unknown tool category'],
    [['--plan', 'p.json', '--max-parallel', '99'], '--max-parallel'],
    [['--plan', 'p.json', '--output-format', 'xml'], '--output-format'],
    [['--plan', 'p.json', '--allow-tools', 'read,shell'], 'also needs --allow-shell'],
    [['--plan', 'p.json', '--allow-shell'], 'also needs shell in --allow-tools'],
    [
      ['--plan', 'p.json', '--allow-tools', 'read,shell', '--allow-shell'],
      'needs --permission-mode',
    ],
    [['--plan', 'missing.json'], 'cannot be read'],
  ])('%j is a usage error, exit 2', async (argv, message) => {
    const run = await cli(argv, {});
    expect(run.code).toBe(2);
    expect(run.err).toContain(message);
  });

  it('says a plan file that is not JSON is unusable, exit 2', async () => {
    const run = await cli(['--plan', 'p.json'], { 'p.json': '{ nope' });
    expect(run.code).toBe(2);
    expect(run.err).toContain('is not valid JSON');
  });
});

describe('clawai orchestrate --dry-run', () => {
  it('prints the validated DAG and the order, starts nothing, needs no credential', async () => {
    const run = await cli(['--plan', 'p.json', '--dry-run'], { 'p.json': diamond() }, {});
    expect(run.code).toBe(0);
    expect(run.out).toContain('2. b + c (parallel)');
    expect(run.out).toContain('d (after b, c)');
  });

  it('prints JSON with --output-format json', async () => {
    const run = await cli(
      ['--plan', 'p.json', '--dry-run', '--output-format', 'json'],
      { 'p.json': diamond() },
      {},
    );
    expect(JSON.parse(run.out)).toMatchObject({ ok: true, waves: [['a'], ['b', 'c'], ['d']] });
  });

  it('lists every problem of a refused plan and exits 2', async () => {
    const bad = plan([
      {
        id: 's',
        agents: [
          agent({ name: 'x', writeScope: ['src/**'] }),
          agent({ name: 'y', writeScope: ['src/**'] }),
        ],
      },
    ]);
    const run = await cli(['--plan', 'p.json', '--dry-run'], { 'p.json': bad }, {});
    expect(run.code).toBe(2);
    expect(run.err).toContain('s/x');
    expect(run.err).toContain('overlap');
  });

  it('--max-parallel overrides the plan', async () => {
    const run = await cli(
      ['--plan', 'p.json', '--dry-run', '--max-parallel', '5'],
      { 'p.json': diamond() },
      {},
    );
    expect(run.out).toContain('up to 5 agent(s)');
  });
});

describe('clawai orchestrate: running', () => {
  it('exits 3 without a credential', async () => {
    const run = await cli(['--plan', 'p.json'], { 'p.json': diamond() }, {});
    expect(run.code).toBe(3);
    expect(run.err).toContain('No credential');
  });

  it('runs a plan with stream-json events and exit 0, then exit 1 for a failed run', async () => {
    const raw = plan([{ id: 's', agents: [agent({ name: 'w', writeScope: ['out/**'] })] }]);
    const { transport } = teamTransport((prompt) => {
      return childName(prompt) === 'w'
        ? async (api) => {
            must(await api.call('workspace.file', 'create', { path: 'out/a.txt', content: 'a' }));
          }
        : async () => undefined;
    });
    const passed = await cli(
      ['--plan', 'p.json', '--output-format', 'stream-json'],
      { 'p.json': raw },
      { CLAW_TOKEN: 't' },
      transport,
    );
    expect(passed.code).toBe(0);
    const lines = passed.out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });
    expect(lines[0]?.type).toBe('orchestrate.started');
    expect(lines.at(-1)?.type).toBe('orchestrate.finished');
    expect(passed.err).toContain('report ');

    const failing = plan([
      {
        id: 's',
        agents: [agent({ name: 'w', writeScope: ['out/**'] })],
        gate: { doneChecks: [{ label: 'nope', command: 'node -e "process.exit(1)"' }] },
      },
    ]);
    const failed = await cli(
      ['--plan', 'p.json'],
      { 'p.json': failing },
      { CLAW_TOKEN: 't' },
      transport,
    );
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('demo: failed');
    expect(failed.err).toContain('[gate] s failed: nope');
  });
});

describe('sub-agent host narrowing', () => {
  it.each([
    [['api.example.com'], ['*.example.com'], undefined],
    [['api.example.com'], ['api.example.com'], undefined],
    [['*.example.com'], ['*.example.com'], undefined],
    [['a.b.example.com'], ['*.example.com'], undefined],
    [['example.com'], ['*.example.com'], 'not inside'],
    [['*.com'], ['*.example.com'], 'too broad'],
    [['api.example.com:8443'], ['api.example.com'], 'not inside'],
    [['api.example.com'], ['api.example.com:8443'], 'not inside'],
    [['api.example.com:443'], ['api.example.com'], undefined],
    [['10.0.0.5'], ['10.0.0.5'], undefined],
    [['10.0.0.6'], ['10.0.0.5'], 'not inside'],
    [['x.test'], undefined, 'none'],
  ])('http %j within %j', (child, parent, problem) => {
    const found = httpHostsProblem(child, parent);
    if (problem === undefined) expect(found).toBeUndefined();
    else expect(found).toContain(problem);
  });

  it('browser hosts must be listed, case-insensitively', () => {
    expect(browserHostsProblem(['claw.local'], ['CLAW.LOCAL'])).toBeUndefined();
    expect(browserHostsProblem(['other.local'], ['claw.local'])).toContain('other.local');
    expect(browserHostsProblem([], undefined)).toBeUndefined();
  });
});
