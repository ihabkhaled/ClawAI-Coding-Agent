import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { BackendRequestError } from '../../src/backend/backend-errors';
import { parseBackendResponse } from '../../src/backend/backend-response';
import { retentionRequestHeaders } from '../../src/backend/zero-retention-guard';

import type { AgentKeyRequester } from '../../src/backend/agent-remote-client';
import type { ZeroRetentionPosture } from '../../src/core/zero-retention.types';
import type { z } from 'zod';

/** The live lane talks to a real stack. Nothing here runs in the default suite. */
export const LIVE_BASE = process.env.CLAW_LIVE_BACKEND_URL ?? 'https://claw.local/api/v1';
export const LIVE_EMAIL = process.env.CLAW_LIVE_EMAIL ?? 'admin@claw.local';
export const LIVE_PASSWORD = process.env.CLAW_LIVE_PASSWORD ?? 'ClawAdmin123!';
export const LIVE_PROVIDER = process.env.CLAW_LIVE_PROVIDER ?? 'GEMINI';
export const LIVE_MODEL = process.env.CLAW_LIVE_MODEL ?? 'models/gemini-2.5-flash-lite';

const GATEWAY_ERRORS = new Set([502, 503, 504]);
const GATEWAY_RETRIES = 20;
const GATEWAY_WAIT_MS = 3_000;
const REFRESH_MARGIN_MS = 120_000;
const ZDR_ON: ZeroRetentionPosture = { active: true, source: 'setting' };
const ZDR_OFF: ZeroRetentionPosture = { active: false, source: 'off' };

export interface RouteRecord {
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly shape: 'OK' | 'FAIL' | 'n/a';
  readonly note: string;
}

const records: RouteRecord[] = [];

/** `:id` for every id-looking segment, so one route is one row however many ids it saw. */
function routeOf(rawPath: string): string {
  return (rawPath.split('?')[0] ?? rawPath)
    .split('/')
    .map((segment) => (/^[A-Za-z0-9_-]{20,}$/u.test(segment) ? ':id' : segment))
    .join('/');
}

export function record(entry: RouteRecord): void {
  records.push({ ...entry, route: routeOf(entry.route) });
}

export function recordedRoutes(): readonly RouteRecord[] {
  return records;
}

export function writeReport(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${name}.json`);
  writeFileSync(target, JSON.stringify(records, null, 2), 'utf8');
  return target;
}

/** One fetch, retried while the dev stack answers 502/503/504 because a service is rebuilding. */
export async function liveFetch(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  for (
    let attempt = 0;
    GATEWAY_ERRORS.has(response.status) && attempt < GATEWAY_RETRIES;
    attempt++
  ) {
    await delay(GATEWAY_WAIT_MS);
    response = await fetch(url, init);
  }
  return response;
}

interface Session {
  accessToken: string;
  expiresAtMs: number;
}
let session: Session | undefined;

function expiryOf(token: string): number {
  const payload = token.split('.')[1];
  try {
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof claims.exp === 'number' ? claims.exp * 1_000 : Date.now() + 600_000;
  } catch {
    return Date.now() + 600_000;
  }
}

export async function signIn(): Promise<string> {
  const response = await liveFetch(`${LIVE_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LIVE_EMAIL, password: LIVE_PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: HTTP ${String(response.status)}`);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  session = {
    accessToken: body.tokens.accessToken,
    expiresAtMs: expiryOf(body.tokens.accessToken),
  };
  return session.accessToken;
}

export async function accessToken(): Promise<string> {
  if (session === undefined || Date.now() > session.expiresAtMs - REFRESH_MARGIN_MS) {
    return signIn();
  }
  return session.accessToken;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The extension's own authenticated request path, minus VS Code: the same
 * retention header rule, the same bounded response reader, and the same zod
 * parse. A response that no longer fits a schema throws here exactly as it
 * would in the editor, and the row is recorded as a shape FAIL.
 */
export function liveRequester(options: { zeroRetention?: boolean } = {}) {
  const posture = options.zeroRetention === true ? ZDR_ON : ZDR_OFF;
  return async function request<T>(
    requestPath: string,
    schema: z.ZodType<T>,
    init: RequestOptions = {},
  ): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
      ...retentionRequestHeaders(method, requestPath, posture),
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await liveFetch(`${LIVE_BASE}${requestPath}`, {
      method,
      headers,
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return settle(method, requestPath, response, schema);
  };
}

/** `BackendClient.agentKeyRequest`: a runner or session credential, or none for public routes. */
export const liveAgentKeyRequester: AgentKeyRequester = async (
  requestPath,
  schema,
  sessionKey,
  init,
) => {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (sessionKey !== null) headers.Authorization = `Bearer ${sessionKey}`;
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await liveFetch(`${LIVE_BASE}${requestPath}`, {
    method,
    headers,
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return settle(method, requestPath, response, schema);
};

async function settle<T>(
  method: string,
  requestPath: string,
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const lease = { response, release: () => undefined, signal: new AbortController().signal };
  try {
    const parsed = await parseBackendResponse(lease, schema);
    record({ method, route: requestPath, status: response.status, shape: 'OK', note: '' });
    return parsed;
  } catch (error) {
    if (error instanceof BackendRequestError) {
      record({
        method,
        route: requestPath,
        status: response.status,
        shape: 'n/a',
        note: 'refused',
      });
    } else {
      record({
        method,
        route: requestPath,
        status: response.status,
        shape: 'FAIL',
        note: error instanceof Error ? error.message.slice(0, 300) : 'parse failure',
      });
    }
    throw error;
  }
}

export interface RawResult {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** A call the extension does not make itself: a signed webhook, a hostile body, a public read. */
export async function rawCall(
  method: string,
  requestPath: string,
  init: { token?: string | null; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResult> {
  const token = init.token === undefined ? await accessToken() : init.token;
  const response = await liveFetch(`${LIVE_BASE}${requestPath}`, {
    method,
    headers: {
      Accept: '*/*',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  const text = await response.text();
  record({ method, route: requestPath, status: response.status, shape: 'n/a', note: 'raw' });
  return { status: response.status, headers: response.headers, text };
}

/** Awaits a request that must be refused and returns the status it was refused with. */
export async function refusedStatus(attempt: Promise<unknown>): Promise<number> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof BackendRequestError) return error.status;
    throw error;
  }
  throw new Error('the request succeeded but a refusal was expected');
}

export async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  limitMs: number,
  everyMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + limitMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await delay(everyMs);
    value = await read();
  }
  return value;
}

/** A 1x1 transparent PNG, the smallest real image an upload will take. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The two request paths every spec uses: ordinary, and with zero data retention on. */
export const request = liveRequester();
export const zdrRequest = liveRequester({ zeroRetention: true });

export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Makes every name this run creates recognisable, and unique against a parallel run. */
export const suffix = randomUUID().slice(0, 8);

const cleanups: { label: string; run: () => Promise<unknown> }[] = [];
const cleanupFailures: string[] = [];
export const defects: string[] = [];

/** Everything a spec creates registers its own deletion here; `finishLane` runs them last-in first. */
export function onCleanup(label: string, run: () => Promise<unknown>): void {
  cleanups.push({ label, run });
}

/** Deletes what the spec made, prints the route table, and returns the failures to assert on. */
export async function finishLane(reportName: string): Promise<{
  shapeFailures: RouteRecord[];
  cleanupFailures: string[];
}> {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup.run();
    } catch (error) {
      cleanupFailures.push(
        `${cleanup.label}: ${error instanceof Error ? error.message : 'failed'}`,
      );
    }
  }
  const table = records.map(
    (row) =>
      `${row.method.padEnd(6)} ${row.route.padEnd(58)} ${String(row.status).padEnd(4)} ${row.shape.padEnd(4)} ${row.note}`,
  );
  process.stdout.write(`\nLIVE API ROUTE TABLE ${reportName} (${String(records.length)} calls)\n`);
  process.stdout.write(`${table.join('\n')}\n`);
  process.stdout.write(
    `cleanup failures: ${cleanupFailures.length === 0 ? 'none' : cleanupFailures.join('; ')}\n`,
  );
  process.stdout.write(`defects noted: ${defects.length === 0 ? 'none' : defects.join(' | ')}\n`);
  process.stdout.write(`report: ${writeReport('test-results', reportName)}\n`);
  return { shapeFailures: records.filter((row) => row.shape === 'FAIL'), cleanupFailures };
}

const THROTTLE_WAIT_MS = 20_000;
const THROTTLE_RETRIES = 4;

/** Retries a call the backend rate-limits (429). The artifact route allows 20 publishes a minute. */
export async function pacedOnThrottle<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (
        !(error instanceof BackendRequestError) ||
        error.status !== 429 ||
        tries >= THROTTLE_RETRIES
      ) {
        throw error;
      }
      await delay(THROTTLE_WAIT_MS);
    }
  }
}
