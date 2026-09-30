import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { argv, env, execPath, exit } from 'node:process';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import {
  createWorkspace,
  runScenario,
  say,
  toolExecutor,
  tokenProvider,
  waitForBackend,
} from './live-agent-session.mjs';
import { LIVE_DEFAULT_BUDGET, LIVE_TOOL_DEFINITIONS } from './live-agent-session.constants.mjs';

/**
 * Proves goal-declared flagship stages (ADR 0004) on a live model.
 *
 * The model is handed a goal and a five-stage list of its own naming and must
 * call `runtime.flagship` with it. The harness executes that call with the
 * extension's real FlagshipDeliveryService and RuntimeFlagshipStageAdapter,
 * bundled from src/ so this cannot drift from what ships. Only the two ports
 * that need a host are replaced: sub-agents run as nested live runs in the same
 * workspace, and integration is a git commit check plus `node --test`.
 *
 * Usage: CLAW_LIVE_EMAIL=… CLAW_LIVE_PASSWORD=… node --use-system-ca
 *   scripts/live-goal-stages.mjs --model=nemotron-3-super [--json=path]
 */
const root = path.resolve(import.meta.dirname, '..');
const flag = (name, fallback) => {
  const found = argv.find((entry) => entry.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};
const MODEL = flag('model', env.CLAW_ROUND_MODELS ?? 'nemotron-3-super');
const PROVIDER = env.CLAW_LIVE_PROVIDER ?? 'OLLAMA';
const GATE_ID = 'gate-node-test';
const EPOCHS = { account: 1, workspace: 1, target: 1, policy: 1 };
const FILES = ['src/slugify.mjs', 'src/slugify.test.mjs'];

const STAGES = [
  {
    id: 'draft-plan',
    kind: 'plan',
    acceptanceChecks: ['A plan names the files to write'],
  },
  {
    id: 'grant-effects',
    kind: 'authorize',
    acceptanceChecks: ['Writes are limited to the declared write set'],
  },
  {
    id: 'write-code',
    kind: 'implement',
    acceptanceChecks: ['slugify and its test are written and committed'],
  },
  {
    id: 'prove-it',
    kind: 'verify',
    acceptanceChecks: ['node --test passes'],
  },
  {
    id: 'merge-work',
    kind: 'integrate',
    acceptanceChecks: ['The commit is integrated and the gate passes'],
  },
];

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60_000 });
const gateResult = (workspace) => run(execPath, ['--test'], workspace);

/** Bundles the extension's real flagship code so the harness runs what ships. */
async function loadFlagship() {
  const built = await build({
    stdin: {
      contents: [
        "export { FlagshipDeliveryService } from './src/services/flagship-delivery-service';",
        "export { RuntimeFlagshipStageAdapter } from './src/services/runtime-flagship-stage-adapter';",
        "export { FlagshipToolExecutor, flagshipToolDefinition } from './src/infrastructure/flagship-tool-executor';",
        "export { subAgentGraphSchema } from './src/core/multi-agent-dag';",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'error',
    banner: {
      js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);",
    },
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'clawai-flagship-bundle-'));
  const file = path.join(dir, 'flagship.mjs');
  writeFileSync(file, built.outputFiles[0].text, 'utf8');
  return import(pathToFileURL(file).href);
}

function planGraph(plan, epochs) {
  const tasks = plan.tasks.map((task) => ({
    taskId: String(task.id)
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]/gu, '-')
      .replace(/^[^a-z]+/u, 'task-'),
    role: 'implementer',
    goal: String(task.goal),
    modelPolicy: {
      allowedProviders: ['AUTO'],
      allowedModels: ['AUTO'],
      localPreferred: false,
      minimumContextTokens: 1_000,
    },
    contextNodeIds: [],
    dependencies: [],
    writeSet: task.writeSet,
    integrationSeams: [],
    worktreeId: 'workspace-main',
    budget: { maxTokens: 100_000, maxToolCalls: 40, maxRuntimeMs: 600_000, maxRetries: 0 },
    tools: ['workspace.files'],
    riskCeiling: 'R3',
    inherit: 'none',
    acceptanceChecks: ['The write set files exist and are committed'],
    epochs,
  }));
  return {
    graphId: `graph-${randomUUID()}`,
    parentRunId: `parent-${randomUUID()}`,
    tasks,
    maxConcurrency: 1,
  };
}

/** The sub-agent port: every stage's sub-agent is a nested live run. */
function subAgentPort(ctx) {
  const nested = async (label, prompt) => {
    const result = await runScenario({
      token: await ctx.nextToken(),
      provider: PROVIDER,
      model: MODEL,
      workspace: ctx.workspace,
      title: `Flagship ${label}`,
      prompt: [
        'You are one stage of a staged delivery, working in the current directory.',
        'Tools: workspace.file (create/read/list; path and content) and workspace.command.',
        prompt,
        'Reply DONE when finished.',
      ].join('\n\n'),
      verbose: false,
    });
    ctx.log(
      `    nested run ${label}: ${result.runId} ${result.terminal} tools=${String(result.toolLog.length)}`,
    );
    return result;
  };
  const base = (task, result, extra) => ({
    taskId: task.taskId,
    changedPaths: [],
    tokens: 0,
    toolCalls: result.toolLog.length,
    modelTurns: result.toolLog.length + 1,
    artifacts: [`run:${result.runId}`],
    findings: [],
    ...extra,
  });

  const runPlan = async (task) => {
    rmSync(path.join(ctx.workspace, 'plan.json'), { force: true });
    const result = await nested(
      'plan',
      [
        'Create plan.json (workspace.file create) holding ONLY this JSON shape:',
        `{"tasks":[{"id":"write-slugify","goal":"<what to build>","writeSet":${JSON.stringify(FILES)}}]}`,
        `Fill in goal: ${ctx.feature}`,
        'Do not write any other file.',
      ].join('\n'),
    );
    try {
      const plan = JSON.parse(readFileSync(path.join(ctx.workspace, 'plan.json'), 'utf8'));
      const graph = planGraph(plan, EPOCHS);
      ctx.flagship.subAgentGraphSchema.parse(graph);
      return base(task, result, { status: 'succeeded', graph });
    } catch (error) {
      return base(task, result, {
        status: 'failed',
        blocker: `No valid plan.json: ${String(error.message).slice(0, 200)}`,
      });
    }
  };

  const runVerify = async (task) => {
    const result = await nested(
      'verify',
      'Run the tests with workspace.command (executable "node", arguments ["--test"]) and report the result. Do not edit files.',
    );
    const ranCommand = result.toolLog.some((entry) => entry.tool.startsWith('workspace.command'));
    const passed = gateResult(ctx.workspace).status === 0;
    const ok = result.terminal === 'run.completed' && ranCommand && passed;
    return base(task, result, {
      status: ok ? 'succeeded' : 'failed',
      ...(ok
        ? {}
        : {
            blocker: `verify: completed=${result.terminal} ranCommand=${String(ranCommand)} testsPass=${String(passed)}`,
          }),
    });
  };

  const runTask = async (task) => {
    if (task.tools.includes('workspace.planning')) return runPlan(task);
    if (task.role === 'tester') return runVerify(task);
    const result = await nested(
      task.taskId,
      [
        task.goal,
        `Write only these files: ${task.writeSet.join(', ')}. Do not run git.`,
        'Use ES modules (.mjs) and node:test with node:assert/strict.',
      ].join('\n'),
    );
    const changed = task.writeSet.filter((file) => existsSync(path.join(ctx.workspace, file)));
    if (changed.length === 0 || task.writeSet.length === 0) {
      return base(task, result, { status: 'failed', blocker: 'No write-set file was created' });
    }
    run('git', ['add', '--', ...changed], ctx.workspace);
    const committed = run('git', ['commit', '-m', `feat: ${task.taskId}`], ctx.workspace);
    const commit = run('git', ['rev-parse', '--short=12', 'HEAD'], ctx.workspace).stdout.trim();
    if (committed.status !== 0)
      return base(task, result, { status: 'failed', blocker: 'git commit failed' });
    return base(task, result, { status: 'succeeded', commit, changedPaths: changed });
  };

  return {
    execute: (task) => runTask(task),
    executeGraph: async (graph) => {
      const outcomes = [];
      for (const task of graph.tasks) outcomes.push(await runTask(task));
      return outcomes;
    },
  };
}

/** Integration: the commit must exist, and the mandatory gate must pass. */
function integrationPort(ctx) {
  return {
    integrate: (candidate) => {
      const commits = candidate.commits.filter(
        (item) => run('git', ['cat-file', '-e', item.commit], ctx.workspace).status === 0,
      );
      const passed =
        commits.length === candidate.commits.length && gateResult(ctx.workspace).status === 0;
      return Promise.resolve({
        integrationId: candidate.integrationId,
        status: passed ? 'integrated' : 'gates-failed',
        integratedCommits: commits.map((item) => item.commit),
        conflicts: [],
        semanticConflicts: [],
        gates: candidate.mandatoryGateIds.map((gateId) => ({ gateId, passed })),
      });
    },
  };
}

function buildPrompt(deliveryId, feature) {
  const request = {
    deliveryId,
    runId: `run-${deliveryId}`,
    goal: feature,
    strategy: 'cross-stack-feature',
    repositories: ['workspace-main'],
    writeSet: FILES,
    acceptanceChecks: ['node --test passes'],
    stages: STAGES,
    mandatoryGateIds: [GATE_ID],
    budget: {
      maxRuntimeMs: 1_500_000,
      maxStageAttempts: 2,
      maxModelTurns: 300,
      maxToolCalls: 400,
      maxSubAgents: 10,
    },
  };
  return [
    'Deliver this feature by calling the runtime.flagship tool, operation "run", exactly once.',
    'Send the request below as the "request" argument, unchanged. It declares the goal\'s own five stages.',
    'When the tool returns, reply with the snapshot lifecycle and stage. Do not do the work yourself.',
    JSON.stringify({ request }),
  ].join('\n\n');
}

const EMAIL = env.CLAW_LIVE_EMAIL;
const PASSWORD = env.CLAW_LIVE_PASSWORD;
if (EMAIL === undefined || PASSWORD === undefined) {
  say('Set CLAW_LIVE_EMAIL and CLAW_LIVE_PASSWORD.');
  exit(2);
}
await waitForBackend();
const nextToken = tokenProvider(EMAIL, PASSWORD);
const flagship = await loadFlagship();
const workspace = createWorkspace({
  'package.json': '{"name":"slug-demo","type":"module","version":"1.0.0"}\n',
  'README.md': '# Slug demo\n',
});
for (const args of [
  ['init', '-q'],
  ['config', 'user.email', 'live@claw.local'],
  ['config', 'user.name', 'Live'],
  ['add', '.'],
  ['commit', '-q', '-m', 'init'],
]) {
  run('git', args, workspace);
}
const feature =
  'Add a function slugify(text) exported from src/slugify.mjs that lowercases, trims and joins words with single hyphens, dropping punctuation, plus src/slugify.test.mjs testing it with node:test.';
const ctx = { workspace, nextToken, flagship, feature, log: say };
const transitions = [];
let lastStage = '';
const observer = {
  update: (snapshot, result) => {
    const key = `${snapshot.stage}/${snapshot.lifecycle}`;
    if (result !== undefined)
      say(`  stage ${snapshot.stage}: ${result.status} (${result.summary.slice(0, 90)})`);
    else if (key !== lastStage) {
      lastStage = key;
      transitions.push(key);
      say(`  -> ${key}`);
    }
  },
};
const checkpoints = new Map();
const service = new flagship.FlagshipDeliveryService(
  new flagship.RuntimeFlagshipStageAdapter(subAgentPort(ctx), () => EPOCHS, integrationPort(ctx)),
  {
    save: (snapshot) => Promise.resolve(void checkpoints.set(snapshot.deliveryId, snapshot)),
    load: (id) => Promise.resolve(checkpoints.get(id)),
    remove: (id) => Promise.resolve(void checkpoints.delete(id)),
  },
  observer,
);
const executor = new flagship.FlagshipToolExecutor(service);
const base = toolExecutor(workspace);
let finalSnapshot;
const execute = async (toolName, operation, args, token) => {
  if (toolName !== 'runtime.flagship') return base(toolName, operation, args, token);
  const output = await executor.execute({ toolName, operation, arguments: args, epochs: EPOCHS });
  finalSnapshot = output.structured.snapshot;
  return output.structured;
};

say(`model: ${MODEL}  workspace: ${workspace}`);
const deliveryId = `delivery-${randomUUID().slice(0, 8)}`;
const outcome = await runScenario({
  token: await nextToken(),
  provider: PROVIDER,
  model: MODEL,
  workspace,
  title: 'Goal-declared stages',
  prompt: buildPrompt(deliveryId, feature),
  toolDefinitions: [...LIVE_TOOL_DEFINITIONS.slice(0, 2), flagship.flagshipToolDefinition],
  executor: execute,
  budget: { ...LIVE_DEFAULT_BUDGET, maxRuntimeMs: 1_800_000, maxToolCalls: 8, maxToolRounds: 6 },
});

const tests = gateResult(workspace);
const sourceExists = FILES.every((file) => existsSync(path.join(workspace, file)));
const log = run('git', ['log', '--oneline'], workspace).stdout.trim().split('\n');
const ok =
  finalSnapshot?.lifecycle === 'done' &&
  sourceExists &&
  tests.status === 0 &&
  log.length >= 2 &&
  STAGES.every((stage) => finalSnapshot.stageSummaries[stage.id] !== undefined);
const report = {
  ok,
  model: MODEL,
  outerRunId: outcome.runId,
  outerTerminal: outcome.terminal,
  outerTools: outcome.toolLog,
  lifecycle: finalSnapshot?.lifecycle,
  stopReason: finalSnapshot?.stopReason,
  transitions,
  attempts: finalSnapshot?.attempts,
  stageSummaries: finalSnapshot?.stageSummaries,
  acceptanceReceipts: finalSnapshot?.acceptanceReceipts,
  unverifiedClaims: finalSnapshot?.unverifiedClaims,
  testsExit: tests.status,
  gitLog: log,
};
say(JSON.stringify(report, null, 2));
if (flag('json', '') !== '')
  writeFileSync(flag('json', ''), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (env.CLAW_KEEP_WORKSPACE !== '1') rmSync(workspace, { force: true, recursive: true });
say(ok ? 'PASS  custom-stage-goal' : 'FAIL  custom-stage-goal');
exit(ok ? 0 : 1);
