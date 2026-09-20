import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env, stdout } from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  LIVE_COMMAND_TIMEOUT_MS,
  TOKEN_ASSUMED_LIFETIME_MS,
  TOKEN_REFRESH_MARGIN_MS,
  LIVE_DEFAULT_BUDGET,
  LIVE_TERMINAL_EVENTS,
  LIVE_TOOL_DEFINITIONS,
} from './live-agent-session.constants.mjs';

// Node provides fetch as a global from 18 onward; naming it here keeps the
// module honest about what it depends on instead of relying on an ambient.
const { fetch } = globalThis;

/**
 * Drives one live coding run against a real backend, for any prompt.
 *
 * Extracted from `live-agent-check.mjs`, which was a single top-level script:
 * it could prove the agent codes once, and could not be pointed at a second
 * prompt or a second model without being copied. Running rounds — the same
 * scenarios across every tool-capable model, after every release — needs the
 * driver separate from the scenario, so both this file's callers share one
 * HTTP contract, one tool executor and one receipt hash.
 *
 * Nothing here asserts anything. A caller supplies the prompt and checks the
 * workspace afterwards; that separation is what stops a scenario from being
 * graded by the same code that produced it.
 */
export const say = (line) => stdout.write(`${line}\n`);
export const sha256 = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export const BASE = env.CLAW_LIVE_BACKEND_URL ?? 'https://claw.local/api/v1';

/**
 * The backend's canonical JSON: keys sorted, and an empty array written as an
 * empty object.
 *
 * The second rule looks wrong and is not. Runtime events pass through a Lua
 * state machine whose JSON decoder cannot tell an empty array from an empty
 * object, so both sides agree to call it an object rather than disagree about
 * a hash.
 */
export function stableJson(value) {
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

export async function api(path_, options = {}, token = undefined) {
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
export async function signIn(email, password) {
  const base64url = (buffer) => buffer.toString('base64url');
  const verifier = base64url(Buffer.from(randomUUID() + randomUUID()).subarray(0, 32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(Buffer.from(randomUUID() + randomUUID()).subarray(0, 32));

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
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

/**
 * A token that stays valid across a long sweep.
 *
 * The access token lives fifteen minutes. A full matrix takes longer than
 * that, so the last models in a sweep were answered `401 Invalid or expired
 * token` and recorded as failures — thirty-five rounds in the first sweep,
 * none of which said anything about the product. Re-authorising just before
 * expiry is the difference between a matrix that tests models and one that
 * tests how fast it ran.
 */
export function tokenProvider(email, password) {
  let token;
  let expiresAtMs = 0;
  return async () => {
    if (token !== undefined && Date.now() < expiresAtMs - TOKEN_REFRESH_MARGIN_MS) return token;
    token = await signIn(email, password);
    expiresAtMs = expiryOf(token);
    return token;
  };
}

/**
 * When the token expires, read from the token itself.
 *
 * A fixed assumed lifetime would be a second place for the backend's session
 * length to be written down, and the one that goes stale silently.
 */
function expiryOf(token) {
  const [, payload] = token.split('.');
  if (payload === undefined) return Date.now() + TOKEN_ASSUMED_LIFETIME_MS;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.exp === 'number'
      ? claims.exp * 1_000
      : Date.now() + TOKEN_ASSUMED_LIFETIME_MS;
  } catch {
    return Date.now() + TOKEN_ASSUMED_LIFETIME_MS;
  }
}

/** A scratch project, with whatever seed files the scenario needs. */
export function createWorkspace(files = {}) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'clawai-live-'));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(workspace, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body, 'utf8');
  }
  return workspace;
}

/**
 * The tool executor, bound to one workspace.
 *
 * A factory rather than module state, because rounds run scenarios one after
 * another and a shared workspace would let one scenario's files satisfy the
 * next one's assertion.
 */
export function toolExecutor(workspace) {
  /** Refuses any path that would leave the scratch workspace. */
  const resolveInside = (relative) => {
    const target = path.resolve(workspace, relative ?? '.');
    if (target !== workspace && !target.startsWith(workspace + path.sep)) {
      throw new Error('Path escapes the workspace');
    }
    return target;
  };

  /**
   * Refuses a read or create that named no file.
   *
   * Without this, a missing `path` resolved to the workspace directory itself
   * and the write failed with EISDIR — a message about directories that says
   * nothing about the actual mistake. The model then repeated the same call
   * until the budget ran out. Naming the missing argument lets it correct
   * itself on the next turn, which is the point of returning an error at all.
   */
  const requirePath = (operation, args) => {
    if (typeof args.path === 'string' && args.path.trim().length > 0) return args.path;
    const provided = Object.keys(args).join(', ') || 'nothing';
    throw new Error(
      `workspace.file ${operation} requires a "path" argument. Received: ${provided}. Shape: ${JSON.stringify(args).slice(0, 300)}`,
    );
  };

  /**
   * Applies the transaction shape the real workspace tool uses.
   *
   * The model produces `{transaction:{operations:[{kind,path,contentLines}]}}`
   * rather than a flat path and content, because that is the shape the
   * product's own file tool takes. Refusing it made the check test a schema
   * nothing uses; accepting it makes this lane exercise what actually ships.
   */
  const applyTransaction = (transaction) => {
    const operations = Array.isArray(transaction?.operations) ? transaction.operations : [];
    if (operations.length === 0)
      throw new Error('workspace.file transaction carried no operations');
    const written = [];
    for (const operation of operations) {
      if (typeof operation?.path !== 'string' || operation.path.trim().length === 0) {
        throw new Error('Each transaction operation needs a "path".');
      }
      const target = resolveInside(operation.path);
      // An operation that names no content used to write an empty file, so a
      // model that muddled the argument name silently destroyed the file it
      // was asked to edit, and the round recorded a bad edit instead of the
      // mistake that caused it. Refusing hands the model something it can
      // correct on its next turn.
      if (!Array.isArray(operation.contentLines) && typeof operation.content !== 'string') {
        throw new Error(
          `Operation on "${operation.path}" carried no content. Send "contentLines" (an array of lines) or "content" (a string). Received keys: ${Object.keys(operation).join(', ')}`,
        );
      }
      const body = Array.isArray(operation.contentLines)
        ? operation.contentLines.join('\n')
        : operation.content;
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body, 'utf8');
      written.push(operation.path);
    }
    return { written };
  };

  const runFileTool = (operation, args) => {
    if (args.transaction !== undefined) return applyTransaction(args.transaction);
    if (operation === 'list') return { entries: readdirSync(workspace) };
    if (operation === 'read')
      return { content: readFileSync(resolveInside(requirePath(operation, args)), 'utf8') };
    if (operation === 'create') {
      const relative = requirePath(operation, args);
      const target = resolveInside(relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, typeof args.content === 'string' ? args.content : '', 'utf8');
      return { written: relative };
    }
    throw new Error(`Unsupported file operation ${operation}`);
  };

  const runCommandTool = (args) => {
    const finished = spawnSync(args.executable, args.arguments ?? [], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: LIVE_COMMAND_TIMEOUT_MS,
      shell: false,
    });
    return {
      exitCode: finished.status ?? -1,
      stdout: (finished.stdout ?? '').slice(0, 4_000),
      stderr: (finished.stderr ?? '').slice(0, 4_000),
    };
  };

  return (toolName, operation, args) =>
    toolName === 'workspace.command' ? runCommandTool(args) : runFileTool(operation, args);
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

/**
 * Runs one prompt to a terminal event and returns what happened.
 *
 * Returns rather than asserts, and never throws on a failed run: a round that
 * ends in `run.failed` is a result to record, not an exception that stops the
 * remaining models from being tested.
 */
export async function runScenario(options) {
  const {
    token,
    prompt,
    provider,
    model,
    workspace,
    title = 'Live agent round',
    budget = LIVE_DEFAULT_BUDGET,
    verbose = true,
  } = options;
  const execute = toolExecutor(workspace);
  const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };
  const toolLog = [];
  const rejectedResults = [];

  // A caller may continue an existing thread. That is the only way to test
  // whether the agent remembers the turn before this one: a fresh thread per
  // prompt tests a fresh agent every time, which is not what a user has.
  let threadId = options.threadId;
  if (threadId === undefined) {
    const thread = await api(
      '/chat-threads',
      { method: 'POST', body: JSON.stringify({ title, routingMode: 'MANUAL_MODEL' }) },
      token,
    );
    threadId = thread.id ?? thread.data?.id;
  }

  const ack = await api(
    '/chat-messages/runtime/runs',
    {
      method: 'POST',
      body: JSON.stringify({
        schemaVersion: '2.0',
        threadId,
        clientRequestId: `request.${randomUUID()}`,
        idempotencyKey: `idem.${randomUUID()}`,
        prompt,
        // The catalog and manifest hashes mirror the extension's own
        // hashRuntimeValue, which is a plain JSON.stringify. Only the
        // tool-result receipt uses the canonical form, and using the wrong one
        // there is a 500 with no detail.
        manifestHash: sha256(JSON.stringify({ targets: ['target:workspace'] })),
        toolCatalogHash: sha256(JSON.stringify(LIVE_TOOL_DEFINITIONS)),
        toolDefinitions: LIVE_TOOL_DEFINITIONS,
        provider,
        model,
        epochs,
        budget,
      }),
    },
    token,
  );

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
    return {
      runId: ack.runId,
      threadId,
      terminal: `stream-http-${String(stream.status)}`,
      toolLog,
    };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = 'stream-ended';
  let answer = '';

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
      if (event.type === 'model.delta' && typeof event.payload?.text === 'string') {
        answer += event.payload.text;
      }

      if (event.type === 'tool.requested') {
        const args = event.payload.invocation?.arguments ?? {};
        let structured;
        let failure;
        try {
          structured = execute(event.payload.toolName, event.payload.operation, args);
        } catch (error) {
          failure = {
            code: 'TOOL_FAILED',
            message: String(error.message).slice(0, 400),
            retryable: false,
            redactionApplied: false,
          };
        }
        const label = `${event.payload.toolName}.${event.payload.operation}`;
        toolLog.push({ tool: label, failed: failure !== undefined });
        // A failed tool call is the most useful line in the log and was the
        // one line not printed. A run that called a tool thirty times and
        // created nothing looked identical to a run that never tried.
        if (verbose) {
          say(
            failure === undefined
              ? `  tool ${label}`
              : `  tool ${label} FAILED: ${failure.message}`,
          );
        }
        // A refused result is not a reason to abandon the round. The backend
        // answers 422 when the run has already ended — typically because an
        // earlier turn produced a tool call it could not act on — and the
        // stream is still about to deliver the real terminal event, which is
        // the thing worth reporting. Throwing here replaced every such run
        // with "not-started", hiding why it actually failed.
        try {
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
        } catch (error) {
          const detail = String(error.message).slice(0, 300);
          rejectedResults.push(detail);
          if (verbose) say(`  result refused: ${detail}`);
        }
      }

      if (LIVE_TERMINAL_EVENTS.includes(event.type)) {
        terminal = event.type;
        // The reason is the whole diagnosis for a run that called no tool. The
        // backend distinguishes "described the work but never requested a
        // tool" from "asked for a tool in a format the protocol does not
        // accept", and without carrying that through, both look like an empty
        // workspace and neither can be acted on.
        const payload = event.payload ?? {};
        const reason =
          typeof payload.reason === 'string'
            ? payload.reason
            : typeof payload.message === 'string'
              ? payload.message
              : typeof payload.reason?.message === 'string'
                ? payload.reason.message
                : '';
        return { runId: ack.runId, threadId, terminal, toolLog, answer, rejectedResults, reason };
      }
    }
  }

  return { runId: ack.runId, threadId, terminal, toolLog, answer, rejectedResults };
}
