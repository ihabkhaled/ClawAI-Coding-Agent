import { rmSync, writeFileSync } from 'node:fs';
import { argv, env, exit, stdout } from 'node:process';

import {
  createWorkspace,
  runScenario,
  say,
  tokenProvider,
  waitForBackend,
} from './live-agent-session.mjs';
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
/**
 * Eight scenarios by default, not fifteen.
 *
 * A full matrix took long enough that it stopped being run after every change,
 * and a lane that is skipped proves nothing. The core set keeps one scenario
 * per capability — edit, command, git, end-to-end delivery, a markdown plan,
 * memory within a thread and across threads, research, and the workspace
 * boundary — preferring the composite scenario where one covers several, and
 * keeping every currently-red scenario so no gap becomes invisible by being
 * dropped from the default.
 *
 * `--scenarios=all` runs the full fifteen; name keys to run exactly those.
 */
const core = LIVE_ROUND_SCENARIOS.filter((scenario) => scenario.core === true);
const scenarios =
  picked.length === 0
    ? core
    : picked.includes('all')
      ? LIVE_ROUND_SCENARIOS
      : LIVE_ROUND_SCENARIOS.filter((scenario) => picked.includes(scenario.key));
const repeat = Number.parseInt(flag('repeat', '1'), 10);
const jsonPath = flag('json', '');

// The dev stack rebuilds on every source change and answers 502 while it
// does. Waiting first turns what used to be a screenful of failed rounds into
// a pause — those 502s said nothing about any model.
await waitForBackend();
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
      let outcome = { terminal: 'not-started', toolLog: [], threadId: undefined };
      let verdict = { ok: false, detail: 'scenario did not run' };
      // A scenario that plants a fact must plant a DIFFERENT one each round.
      // Re-planting the same words made them ordinary: after forty rounds
      // "canary" appeared in 78 of this account's messages and "cohort" in
      // 116, so retrieval correctly classified both as words the user says
      // all the time — the round had made its own needle into hay. A fresh
      // subject per round also stops an earlier round's thread from being a
      // valid answer, which is a stricter test than the fixed one was.
      const planted = scenario.plant === undefined ? {} : scenario.plant();
      const prompts =
        typeof scenario.prompts === 'function'
          ? scenario.prompts(planted)
          : (scenario.prompts ?? [scenario.prompt]);
      const startedAt = Date.now();
      try {
        // A scenario may take several turns in one thread. Everything the
        // agent is supposed to remember is tested that way and no other: a new
        // thread per prompt asks a fresh agent each time.
        for (const entry of prompts) {
          // An entry may ask for a fresh thread. That is how cross-thread
          // memory is tested: the fact is told in one conversation and asked
          // for in another, which is a different question from remembering
          // within a thread and needs a different retrieval path.
          const step = typeof entry === 'string' ? { prompt: entry } : entry;
          outcome = await runScenario({
            token: await nextToken(),
            provider: PROVIDER,
            model,
            workspace,
            title: `Round: ${scenario.key}`,
            prompt: step.prompt,
            threadId: step.newThread === true ? undefined : outcome.threadId,
            verbose: false,
          });
        }
        verdict = scenario.assert(workspace, planted);
      } catch (error) {
        const message = String(error.message);
        // A backend that is restarting is not a result. Wait for it and run
        // the round again rather than blaming the model for nginx.
        if (/HTTP 50[0-9]/u.test(message) && (await waitForBackend())) {
          try {
            outcome = await runScenario({
              token: await nextToken(),
              provider: PROVIDER,
              model,
              workspace,
              title: `Round: ${scenario.key}`,
              prompt: prompts[0]?.prompt ?? prompts[0],
              verbose: false,
            });
            verdict = scenario.assert(workspace, planted);
          } catch (retryError) {
            verdict = { ok: false, detail: `threw: ${String(retryError.message).slice(0, 160)}` };
          }
        } else {
          verdict = { ok: false, detail: `threw: ${message.slice(0, 160)}` };
        }
      }
      const durationMs = Date.now() - startedAt;
      const failedTools = outcome.toolLog.filter((entry) => entry.failed).length;
      results.push({
        model,
        scenario: scenario.key,
        attempt,
        ok: verdict.ok,
        ...(scenario.knownGap === undefined ? {} : { knownGap: scenario.knownGap }),
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

// A known gap is reported, never silently passed and never deleted. It does
// not fail the sweep, because a permanently red suite stops being read — but
// it is printed every time, with its reason, so it cannot quietly become
// normal.
const gaps = results.filter((entry) => !entry.ok && entry.knownGap !== undefined);
const failed = results.filter((entry) => !entry.ok && entry.knownGap === undefined);
say('');
say(
  `rounds: ${String(results.length)}  passed: ${String(results.filter((entry) => entry.ok).length)}  failed: ${String(failed.length)}  known gaps: ${String(gaps.length)}`,
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
if (gaps.length > 0) {
  say('');
  say(`known gaps (not counted as failures): ${String(gaps.length)}`);
  for (const entry of gaps) {
    say(`  ${entry.model} · ${entry.scenario} — ${entry.knownGap} · got ${entry.detail}`);
  }
}
if (jsonPath.length > 0) {
  writeFileSync(jsonPath, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');
  say(`evidence: ${jsonPath}`);
}

exit(failed.length === 0 ? 0 : 1);
