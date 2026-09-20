import { rmSync, writeFileSync } from 'node:fs';
import { argv, env, exit, stdout } from 'node:process';

import { createWorkspace, runScenario, say, tokenProvider } from './live-agent-session.mjs';
import { LIVE_ROUND_SCENARIOS } from './live-rounds.scenarios.mjs';

/**
 * Runs every coding scenario against every model, and reports what failed.
 *
 * The single live check proves one model can do one thing. This proves which
 * models can do which things, which is the question that matters before a
 * release: an agent that reads files but cannot commit, or that passes with
 * one model and silently fails with another, is not a coding agent yet.
 *
 * Every round gets its own workspace and its own thread, and every assertion
 * reads the workspace rather than the run's own report. A round that ends in
 * `run.failed` is recorded and the matrix continues — one bad model must not
 * hide the results for the rest.
 *
 * Usage:
 *   CLAW_LIVE_EMAIL=… CLAW_LIVE_PASSWORD=… node scripts/live-rounds.mjs
 *   --models=kimi-k3,glm-5.2   pick models (default: CLAW_ROUND_MODELS or kimi-k3)
 *   --scenarios=git-commit,…   pick scenarios (default: all)
 *   --repeat=3                 run each pair this many times
 *   --json=path                write the full result matrix for evidence
 */
const EMAIL = env.CLAW_LIVE_EMAIL;
const PASSWORD = env.CLAW_LIVE_PASSWORD;
const PROVIDER = env.CLAW_LIVE_PROVIDER ?? 'OLLAMA';

if (EMAIL === undefined || PASSWORD === undefined) {
  stdout.write('Set CLAW_LIVE_EMAIL and CLAW_LIVE_PASSWORD to run live rounds.\n');
  exit(2);
}

const flag = (name, fallback) => {
  const found = argv.find((entry) => entry.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};

const models = flag('models', env.CLAW_ROUND_MODELS ?? 'kimi-k3')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const picked = flag('scenarios', '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const scenarios =
  picked.length === 0
    ? LIVE_ROUND_SCENARIOS
    : LIVE_ROUND_SCENARIOS.filter((scenario) => picked.includes(scenario.key));
const repeat = Number.parseInt(flag('repeat', '1'), 10);
const jsonPath = flag('json', '');

// Re-authorises itself: a full matrix outlives one access token.
const nextToken = tokenProvider(EMAIL, PASSWORD);
await nextToken();
say(`models: ${models.join(', ')}`);
say(`scenarios: ${scenarios.map((scenario) => scenario.key).join(', ')}`);
say(`rounds: ${String(models.length * scenarios.length * repeat)}`);
say('');

const results = [];
for (const model of models) {
  for (const scenario of scenarios) {
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const workspace = createWorkspace(scenario.files);
      const label = `${model} · ${scenario.key}${repeat > 1 ? ` #${String(attempt)}` : ''}`;
      let outcome = { terminal: 'not-started', toolLog: [] };
      let verdict = { ok: false, detail: 'scenario did not run' };
      const startedAt = Date.now();
      try {
        outcome = await runScenario({
          token: await nextToken(),
          provider: PROVIDER,
          model,
          workspace,
          title: `Round: ${scenario.key}`,
          prompt: scenario.prompt,
          verbose: false,
        });
        verdict = scenario.assert(workspace);
      } catch (error) {
        verdict = { ok: false, detail: `threw: ${String(error.message).slice(0, 160)}` };
      }
      const durationMs = Date.now() - startedAt;
      const failedTools = outcome.toolLog.filter((entry) => entry.failed).length;
      results.push({
        model,
        scenario: scenario.key,
        attempt,
        ok: verdict.ok,
        detail: verdict.detail,
        terminal: outcome.terminal,
        toolCalls: outcome.toolLog.length,
        failedTools,
        durationMs,
        // Only for a failure, and only the opening: a round that called no
        // tool leaves nothing in the workspace to diagnose, so what the model
        // said instead is the only evidence of why.
        ...(verdict.ok ? {} : { answer: (outcome.answer ?? '').slice(0, 400) }),
        ...(outcome.reason ? { reason: outcome.reason.slice(0, 300) } : {}),
        ...(outcome.rejectedResults?.length > 0
          ? { rejectedResults: outcome.rejectedResults.slice(0, 3) }
          : {}),
      });
      say(
        `${verdict.ok ? 'PASS' : 'FAIL'}  ${label}  [${outcome.terminal}, ${String(outcome.toolLog.length)} tools` +
          `${failedTools > 0 ? `, ${String(failedTools)} failed` : ''}, ${String(Math.round(durationMs / 1000))}s]  ${verdict.detail}`,
      );
      rmSync(workspace, { force: true, recursive: true });
    }
  }
}

const failed = results.filter((entry) => !entry.ok);
say('');
say(
  `rounds: ${String(results.length)}  passed: ${String(results.length - failed.length)}  failed: ${String(failed.length)}`,
);
for (const model of models) {
  const mine = results.filter((entry) => entry.model === model);
  const good = mine.filter((entry) => entry.ok).length;
  say(`  ${model}: ${String(good)}/${String(mine.length)}`);
}
if (failed.length > 0) {
  say('');
  say('failures:');
  for (const entry of failed) {
    say(`  ${entry.model} · ${entry.scenario} · ${entry.terminal} · ${entry.detail}`);
    if (typeof entry.reason === 'string' && entry.reason.length > 0) {
      say(`    run reason: ${entry.reason.slice(0, 220)}`);
    }
    for (const refusal of entry.rejectedResults ?? []) {
      say(`    tool result refused: ${refusal.replace(/\s+/gu, ' ').slice(0, 200)}`);
    }
    if (entry.toolCalls === 0 && typeof entry.answer === 'string' && entry.answer.length > 0) {
      say(`    called no tool; answered: ${entry.answer.replace(/\s+/gu, ' ').slice(0, 220)}`);
    }
  }
}
if (jsonPath.length > 0) {
  writeFileSync(jsonPath, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');
  say(`evidence: ${jsonPath}`);
}

exit(failed.length === 0 ? 0 : 1);
