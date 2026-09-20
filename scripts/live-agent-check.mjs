import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { argv, env, execPath, exit, stdout } from 'node:process';

import { createWorkspace, runScenario, say, signIn } from './live-agent-session.mjs';

/**
 * Proves the coding agent can actually code, against a live backend.
 *
 * Every other lane in this repository proves the code is correct, the artifact
 * is well formed, and the extension activates. None of them proves the thing
 * the product is for: that a model, given tools, will read a file, write code,
 * run it, and finish. This does, and it fails loudly when it cannot.
 *
 * It drives the same HTTP contract the extension drives — the VS Code PKCE
 * authorization, the runtime run, the event stream, and the tool-result receipt
 * with its canonical hash — so a backend change that would break the extension
 * breaks this first.
 *
 * The scenario is deliberately end-to-end rather than a single tool call: read
 * an existing file, write two new ones, run the result, and correct it if the
 * output is wrong. A model that can only make one tool call looks fine in a
 * one-step test and cannot build anything.
 *
 * The final assertion does not trust the model, the stream, or the receipts. It
 * runs the produced program in a separate process and reads its output.
 *
 * The driver lives in `live-agent-session.mjs`, shared with `live-rounds.mjs`.
 * This file is one scenario and its assertion; that is the whole difference
 * between the two lanes.
 *
 * Not part of `npm run check`: it needs a running stack, real credentials and a
 * paid model call, none of which belong in a deterministic gate.
 */
const EMAIL = env.CLAW_LIVE_EMAIL;
const PASSWORD = env.CLAW_LIVE_PASSWORD;
const PROVIDER = env.CLAW_LIVE_PROVIDER ?? 'OLLAMA';
const MODEL = env.CLAW_LIVE_MODEL ?? 'kimi-k3';
const KEEP = argv.includes('--keep');

if (EMAIL === undefined || PASSWORD === undefined) {
  stdout.write(
    [
      'Set CLAW_LIVE_EMAIL and CLAW_LIVE_PASSWORD to run the live agent check.',
      'Optional: CLAW_LIVE_BACKEND_URL, CLAW_LIVE_PROVIDER, CLAW_LIVE_MODEL.',
      'If the backend uses a local certificate authority, point NODE_EXTRA_CA_CERTS at its root.',
      '',
    ].join('\n'),
  );
  exit(2);
}

const workspace = createWorkspace({
  'README.md': '# Live workspace\n\nA scratch Node.js project used to prove the agent can code.\n',
});
const token = await signIn(EMAIL, PASSWORD);
say(`workspace: ${workspace}`);

const outcome = await runScenario({
  token,
  provider: PROVIDER,
  model: MODEL,
  workspace,
  title: 'Live agent check',
  prompt: [
    'Work in this Node.js workspace, using the tools provided.',
    '1) Read README.md with workspace.file operation "read".',
    '2) Create greet.js with workspace.file operation "create". It must export a',
    '   function greet(name) returning "Hello, <name>!" via module.exports.',
    '3) Create check.js that requires ./greet and prints greet("Claw").',
    '4) Run it with workspace.command operation "run", executable "node",',
    '   arguments ["check.js"].',
    '5) If the output is not exactly "Hello, Claw!", fix the files and run it again.',
    'When the command prints Hello, Claw! stop and reply DONE.',
  ].join(' '),
});
say(`run: ${outcome.runId}`);
say(`run ended: ${outcome.terminal}`);

// The assertion trusts nothing the run reported. It runs what was written.
const verification = spawnSync(execPath, ['check.js'], {
  cwd: workspace,
  encoding: 'utf8',
  timeout: 30_000,
});
const passed = (verification.stdout ?? '').includes('Hello, Claw!');
say(`files: ${readdirSync(workspace).join(', ')}`);
say(`tool calls: ${String(outcome.toolLog.length)}`);
say(`verification exit: ${String(verification.status)}`);
say(
  passed ? 'PASS — the agent wrote code that runs correctly' : 'FAIL — the workspace does not run',
);

if (!KEEP) rmSync(workspace, { force: true, recursive: true });
exit(passed ? 0 : 1);
