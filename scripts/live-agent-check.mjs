import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env, argv, execPath, exit, stdout } from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { TextDecoder } from 'node:util';

// Node provides fetch as a global from 18 onward; naming it here keeps the
// module honest about what it depends on instead of relying on an ambient.
const { fetch } = globalThis;

/**
 * Proves the coding agent can actually code, against a live backend.
 *
 * Every other lane in this repository proves the code is correct, the artifact
 * is well formed, and the extension activates. None of them proves the thing the
 * product is for: that a model, given tools, will read a file, write code, run
 * it, and finish. This does, and it fails loudly when it cannot.
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
 * Not part of `npm run check`: it needs a running stack, real credentials and a
 * paid model call, none of which belong in a deterministic gate.
 */
const BASE = env.CLAW_LIVE_BACKEND_URL ?? 'https://claw.local/api/v1';
const EMAIL = env.CLAW_LIVE_EMAIL;
const PASSWORD = env.CLAW_LIVE_PASSWORD;
const PROVIDER = env.CLAW_LIVE_PROVIDER ?? 'ANTHROPIC';
const MODEL = env.CLAW_LIVE_MODEL ?? 'claude-haiku-4-5-20251001';
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

const say = (line) => stdout.write(`${line}\n`);
const sha256 = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/**
 * The backend's canonical JSON: keys sorted, and an empty array written as an
 * empty object.
 *
 * The second rule looks wrong and is not. Runtime events pass through a Lua
 * state machine whose JSON decoder cannot tell an empty array from an empty
 * object, so both sides agree to call it an object rather than disagree about
 * a hash.
 */
function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value))
    return value.length === 0 ? '{}' : `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

async function api(path_, options = {}, token = undefined) {
  const response = await fetch(BASE + path_, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path_} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  return text.length === 0 ? null : JSON.parse(text);
}

/**
 * Completes the VS Code authorization without a browser.
 *
 * The approval step is an ordinary authenticated call; the browser page in the
 * product is a client for it, not a gate in front of it. That is what makes an
 * automated live check possible at all.
 */
async function signIn() {
  const base64url = (buffer) => buffer.toString('base64url');
  const verifier = base64url(Buffer.from(randomUUID() + randomUUID()).subarray(0, 32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(Buffer.from(randomUUID() + randomUUID()).subarray(0, 32));

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const init = await api('/auth/vscode/authorize/init', {
    method: 'POST',
    body: JSON.stringify({
      callbackUri: 'vscode://clawai.clawai-coding-agent/auth/callback',
      state,
      codeChallenge: challenge,
      clientName: 'ClawAI for VS Code',
    }),
  });
  const approval = await api(
    '/auth/vscode/authorize/approve',
    { method: 'POST', body: JSON.stringify({ requestId: init.requestId }) },
    login.tokens.accessToken,
  );
  const code = new URL(approval.redirectUri).searchParams.get('code');
  const exchanged = await api('/auth/vscode/authorize/exchange', {
    method: 'POST',
    body: JSON.stringify({ code, codeVerifier: verifier }),
  });
  return exchanged.tokens.accessToken;
}

const workspace = mkdtempSync(path.join(tmpdir(), 'clawai-live-'));
writeFileSync(
  path.join(workspace, 'README.md'),
  '# Live workspace\n\nA scratch Node.js project used to prove the agent can code.\n',
);

const fileTool = {
  schemaVersion: '2.0',
  name: 'workspace.file',
  version: '2.0.0',
  description: 'Read, write and list files in the workspace.',
  operations: ['read', 'create', 'list'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', maxLength: 4096 },
      content: { type: 'string', maxLength: 100000 },
    },
  },
};

const commandTool = {
  schemaVersion: '2.0',
  name: 'workspace.command',
  version: '2.0.0',
  description: 'Run a bounded command in the workspace and return its output.',
  operations: ['run'],
  riskClasses: ['process'],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      executable: { type: 'string', maxLength: 200 },
      arguments: { type: 'array', items: { type: 'string', maxLength: 4096 }, maxItems: 50 },
    },
    required: ['executable'],
  },
};

/** Refuses any path that would leave the scratch workspace. */
function resolveInside(relative) {
  const target = path.resolve(workspace, relative ?? '.');
  if (target !== workspace && !target.startsWith(workspace + path.sep)) {
    throw new Error('Path escapes the workspace');
  }
  return target;
}

function runFileTool(operation, args) {
  const target = resolveInside(args.path);
  if (operation === 'list') return { entries: readdirSync(workspace) };
  if (operation === 'read') return { content: readFileSync(target, 'utf8') };
  if (operation === 'create') {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, args.content ?? '', 'utf8');
    return { written: args.path };
  }
  throw new Error(`Unsupported file operation ${operation}`);
}

function runCommandTool(args) {
  const finished = spawnSync(args.executable, args.arguments ?? [], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30_000,
    shell: false,
  });
  return {
    exitCode: finished.status ?? -1,
    stdout: (finished.stdout ?? '').slice(0, 4_000),
    stderr: (finished.stderr ?? '').slice(0, 4_000),
  };
}

const token = await signIn();
say(`workspace: ${workspace}`);

const thread = await api(
  '/chat-threads',
  {
    method: 'POST',
    body: JSON.stringify({ title: 'Live agent check', routingMode: 'MANUAL_MODEL' }),
  },
  token,
);
const threadId = thread.id ?? thread.data?.id;
const definitions = [fileTool, commandTool];
const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

const ack = await api(
  '/chat-messages/runtime/runs',
  {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: '2.0',
      threadId,
      clientRequestId: `request.${randomUUID()}`,
      idempotencyKey: `idem.${randomUUID()}`,
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
      // The catalog and manifest hashes mirror the extension's own hashRuntimeValue,
      // which is a plain JSON.stringify. Only the tool-result receipt uses the
      // canonical form, and using the wrong one there is a 500 with no detail.
      manifestHash: sha256(JSON.stringify({ targets: ['target:workspace'] })),
      toolCatalogHash: sha256(JSON.stringify(definitions)),
      toolDefinitions: definitions,
      provider: PROVIDER,
      model: MODEL,
      epochs,
      budget: {
        maxModelTurns: 20,
        maxToolCalls: 30,
        maxToolRounds: 20,
        maxRepairAttempts: 1,
        maxRuntimeMs: 300_000,
        maxOutputBytes: 1_048_576,
        maxToolResultBytes: 262_144,
      },
    }),
  },
  token,
);
say(`run: ${ack.runId}`);

const query = new URLSearchParams({
  protocol: 'v2',
  runId: ack.runId,
  generation: ack.generation,
  after: '0',
});
const stream = await fetch(
  `${BASE}/chat-messages/stream/${encodeURIComponent(threadId)}?${query.toString()}`,
  { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } },
);
if (!stream.ok) {
  say(`stream failed: HTTP ${stream.status}`);
  exit(1);
}

/** Builds the result the backend will verify, including the receipt it hashes. */
function toolResult(invocationId, args, structured, failure) {
  const startedAt = new Date().toISOString();
  const modelText = structured === undefined ? null : JSON.stringify(structured).slice(0, 2_000);
  const canonical = stableJson({
    error: failure ?? null,
    modelText,
    structured: structured ?? null,
  });
  return {
    schemaVersion: '2.0',
    invocationId,
    status: failure === undefined ? 'succeeded' : 'failed',
    ...(structured === undefined ? {} : { structured }),
    ...(modelText === null ? {} : { modelText }),
    ...(failure === undefined ? {} : { error: failure }),
    receipt: {
      schemaVersion: '2.0',
      receiptId: `receipt.${randomUUID()}`,
      invocationId,
      argumentHash: sha256(stableJson(args)),
      resultHash: sha256(canonical),
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      outputBytes: Buffer.byteLength(canonical, 'utf8'),
      truncated: false,
      redactionApplied: false,
    },
    continuation: { action: 'continue', nextTurnId: `turn.${randomUUID()}` },
  };
}

const decoder = new TextDecoder();
let buffer = '';
let finished = false;
let toolCalls = 0;

for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';
  for (const frame of frames) {
    const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
    if (line === undefined) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (typeof event.type !== 'string') continue;

    if (event.type === 'tool.requested') {
      toolCalls += 1;
      const args = event.payload.invocation?.arguments ?? {};
      let structured;
      let failure;
      try {
        structured =
          event.payload.toolName === commandTool.name
            ? runCommandTool(args)
            : runFileTool(event.payload.operation, args);
      } catch (error) {
        failure = {
          code: 'TOOL_FAILED',
          message: String(error.message).slice(0, 400),
          retryable: false,
          redactionApplied: false,
        };
      }
      say(`  tool ${event.payload.toolName}.${event.payload.operation}`);
      await api(
        `/chat-messages/runtime/runs/${encodeURIComponent(ack.runId)}/results?threadId=${encodeURIComponent(threadId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            generation: ack.generation,
            idempotencyKey: `idem.${randomUUID()}`,
            epochs,
            result: toolResult(event.payload.invocationId, args, structured, failure),
          }),
        },
        token,
      );
    }

    if (['run.completed', 'run.failed', 'run.cancelled', 'run.blocked'].includes(event.type)) {
      say(`run ended: ${event.type}`);
      finished = true;
    }
  }
  if (finished) break;
}

// The assertion trusts nothing the run reported. It runs what was written.
const verification = spawnSync(execPath, ['check.js'], {
  cwd: workspace,
  encoding: 'utf8',
  timeout: 30_000,
});
const passed = (verification.stdout ?? '').includes('Hello, Claw!');
say(`files: ${readdirSync(workspace).join(', ')}`);
say(`tool calls: ${String(toolCalls)}`);
say(`verification exit: ${String(verification.status)}`);
say(
  passed ? 'PASS — the agent wrote code that runs correctly' : 'FAIL — the workspace does not run',
);

if (!KEEP) rmSync(workspace, { force: true, recursive: true });
exit(passed ? 0 : 1);
