const process = require('node:process');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

// Generous, CI-safe budgets: they catch a runaway (a polling loop, a leaked
// watcher, an activation that starts loading the world), not a 10% drift.
const IDLE_RSS_BUDGET_MB = 1500;
const IDLE_HEAP_BUDGET_MB = 600;
const IDLE_WINDOW_MS = 3_000;
const TIMER_GROWTH_BUDGET = 5;

function countByKind(kinds) {
  const counts = {};
  for (const kind of kinds) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

async function run() {
  const extension = vscode.extensions.getExtension('clawai.clawai-coding-agent');
  assert.ok(extension?.isActive, 'perf lane runs after activation');
  await delay(500);
  const before = process.getActiveResourcesInfo();
  const memoryBefore = process.memoryUsage();
  await delay(IDLE_WINDOW_MS);
  const after = process.getActiveResourcesInfo();
  const memoryAfter = process.memoryUsage();
  const timersBefore = countByKind(before).Timeout ?? 0;
  const timersAfter = countByKind(after).Timeout ?? 0;
  const rssMb = Math.round(memoryAfter.rss / 1048576);
  const heapMb = Math.round(memoryAfter.heapUsed / 1048576);
  const heapDriftMb = Math.round((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1048576);
  process.stdout.write(
    `HOST_PERF ${JSON.stringify({ rssMb, heapMb, heapDriftMb, timersBefore, timersAfter, resources: countByKind(after) })}\n`,
  );
  assert.ok(rssMb < IDLE_RSS_BUDGET_MB, `idle RSS ${String(rssMb)}MB is under budget`);
  assert.ok(heapMb < IDLE_HEAP_BUDGET_MB, `idle heap ${String(heapMb)}MB is under budget`);
  // Signed out and idle: nothing of ours should be polling, so the timer count
  // must not climb while the window sits still.
  assert.ok(
    timersAfter - timersBefore <= TIMER_GROWTH_BUDGET,
    `idle timers grew from ${String(timersBefore)} to ${String(timersAfter)}`,
  );
}

module.exports = { runPerf: run };
