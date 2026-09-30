/**
 * The live API lane, part: runtime runs, rewind, files, zero data retention. Excluded from `npm test`; run with
 * `npm run test:live-api`.
 *
 * Calls real routes through the extension's own clients and parses every
 * answer with the extension's own zod schemas, so a backend shape change fails
 * here rather than in a user's editor. Everything created is deleted at the
 * end, and the route table (status and shape per route) is printed and written
 * to `test-results/`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  messagePageSchema,
  messageSchema,
  uploadedFileSchema,
  usageSchema,
} from '../../src/backend/contracts';
import { deleteFile, uploadFile } from '../../src/backend/file-client';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { listMessages, rewindThread } from '../../src/backend/thread-client';
import { fetchAccountUsageSections } from '../../src/backend/usage-breakdown-client';
import { chatAttachmentSchema } from '../../src/core/chat-attachment';
import { canonicalJson } from '../../src/core/runtime/runtime-tool-result';

import {
  LIVE_MODEL,
  LIVE_PROVIDER,
  TINY_PNG_BASE64,
  defects,
  finishLane,
  onCleanup,
  refusedStatus,
  request,
  sha256,
  signIn,
  suffix,
  until,
  zdrRequest,
} from './live-api.helpers';
import {
  EPOCHS,
  NOTEBOOK_TOOL,
  REDACTED,
  newThread,
  runtimeClient,
  startBody,
  waitRunEnded,
} from './live-api.runtime-helpers';

import type { RuntimeCommandBinding } from '../../src/backend/backend-client.types';
import type { ToolResult } from '../../src/core/runtime/runtime-tool-contracts';

const uploadedFiles: { image?: string; text?: string } = {};
let control: { threadId: string; runId: string; generation: string } | undefined;
let usageBefore = 0;
let dayUsedBefore = 0;

beforeAll(async () => {
  await signIn();
  usageBefore = (await fetchAccountUsageSections(request)).account?.totals.requests ?? 0;
  dayUsedBefore = (await request('/auth/me/usage', usageSchema)).day.used;
}, 120_000);

afterAll(async () => {
  const outcome = await finishLane('runtime');
  expect(outcome.shapeFailures).toEqual([]);
  expect(outcome.cleanupFailures).toEqual([]);
}, 300_000);

describe('live API lane: runtime', () => {
  it('files: upload, image and text, and delete', async () => {
    const image = await uploadFile(
      request,
      chatAttachmentSchema.parse({
        clientId: `live-${suffix}-png`,
        content: TINY_PNG_BASE64,
        filename: `live-${suffix}.png`,
        mimeType: 'image/png',
        sizeBytes: Buffer.from(TINY_PNG_BASE64, 'base64').length,
      }),
    );
    onCleanup(`file ${image.id}`, () => deleteFile(request, image.id));
    const text = await uploadFile(
      request,
      chatAttachmentSchema.parse({
        clientId: `live-${suffix}-txt`,
        content: Buffer.from('live api lane').toString('base64'),
        filename: `live-${suffix}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 13,
      }),
    );
    onCleanup(`file ${text.id}`, () => deleteFile(request, text.id));
    uploadedFiles.image = image.id;
    uploadedFiles.text = text.id;
    expect(uploadedFileSchema.parse(image).id).toBe(image.id);
  });

  it('runtime run (control): active-run, deferred tool load, tool-result fileIds ownership', async () => {
    const thread = await newThread(false, `live-api-lane-run-${suffix}`);
    const client = runtimeClient(false);
    const { body, catalog } = startBody(
      thread.id,
      'Reply with the single word pong. Do not use any tool.',
    );
    expect(catalog.deferred.map((entry) => entry.name)).toEqual(['workspace.notebook']);
    const ack = await client.start(body);
    control = { threadId: thread.id, runId: ack.runId, generation: ack.generation };
    const binding: RuntimeCommandBinding = {
      threadId: thread.id,
      runId: ack.runId,
      generation: ack.generation,
      epochs: EPOCHS,
    };

    const active = await remoteSessionClient.activeRun(request, thread.id);
    expect(typeof active.active).toBe('boolean');

    const loaded = await client.loadTools(binding, [NOTEBOOK_TOOL]);
    expect(loaded.loaded).toEqual([{ name: 'workspace.notebook', version: '2.0.0' }]);

    const result = (fileIds: string[]): ToolResult => ({
      schemaVersion: '2.0',
      invocationId: 'invocation.live-lane',
      status: 'succeeded',
      structured: {},
      fileIds,
      receipt: {
        schemaVersion: '2.0',
        receiptId: 'receipt.live-lane',
        invocationId: 'invocation.live-lane',
        argumentHash: `sha256:${sha256(canonicalJson({}))}`,
        resultHash: `sha256:${sha256(canonicalJson({ fileIds }))}`,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        outputBytes: 2,
        truncated: false,
        redactionApplied: false,
      },
      continuation: { action: 'continue', nextTurnId: 'turn.live-lane' },
    });
    // An id nobody owns and an id another account owns answer the same way.
    const missing = await refusedStatus(
      client.submitResult(binding, `idem.${randomUUID()}`, result(['file-that-does-not-exist'])),
    );
    expect(missing).toBe(404);
    const notImage = await refusedStatus(
      client.submitResult(binding, `idem.${randomUUID()}`, result([uploadedFiles.text ?? 'x'])),
    );
    expect(notImage).toBeGreaterThanOrEqual(400);
    expect(notImage).not.toBe(404);
    const ownedImage = await refusedStatus(
      client.submitResult(binding, `idem.${randomUUID()}`, result([uploadedFiles.image ?? 'x'])),
    );
    // Ownership passed (not the file-unavailable 404); the run refuses the made-up invocation instead.
    expect(ownedImage).toBeGreaterThanOrEqual(400);
    expect(ownedImage).not.toBe(404);
    if (ownedImage >= 500) {
      defects.push(
        `POST runs/:id/results answers ${String(ownedImage)} (not a 4xx) for a well-formed result naming an unknown invocation`,
      );
    }
    expect(await waitRunEnded(thread.id)).toBe(true);
    const finished = await remoteSessionClient.activeRun(request, thread.id);
    expect(finished.active).toBe(false);
  }, 400_000);

  it('rewind: drops messages after the kept one, refuses a foreign message id', async () => {
    expect(control, 'the control run did not start').toBeDefined();
    const threadId = control?.threadId ?? '';
    const messages = await until(
      () => listMessages(request, threadId, 50),
      (list) => list.length >= 2,
      60_000,
    );
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const ordered = [...messages].sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt)),
    );
    const keep = ordered[0];
    expect(keep?.role.toUpperCase()).toBe('USER');
    const refused = await refusedStatus(rewindThread(request, threadId, 'message-from-elsewhere'));
    expect(refused).toBeGreaterThanOrEqual(400);
    const result = await rewindThread(request, threadId, keep?.id ?? '');
    expect(result.removedCount).toBeGreaterThanOrEqual(1);
    expect(result.afterMessageId).toBe(keep?.id);
    const after = await listMessages(request, threadId, 50);
    expect(after.map((entry) => entry.id)).toEqual([keep?.id]);
    const missingThread = await refusedStatus(
      rewindThread(request, 'no-such-thread-id-0000000', 'x'),
    );
    expect(missingThread).toBe(404);
  });

  it('zero retention: a real runtime run is redacted after completion and its usage is kept', async () => {
    const marker = `zdr-marker-${randomUUID()}`;
    const thread = await newThread(true, 'ignored');
    const { body } = startBody(thread.id, `Reply with the single word pong. ${marker}`);
    const client = runtimeClient(true);
    await client.start(body);
    expect(await waitRunEnded(thread.id)).toBe(true);
    const messages = await until(
      () => listMessages(request, thread.id, 50),
      (list) => list.length >= 1 && list.every((entry) => entry.content === REDACTED),
      60_000,
    );
    expect(messages.length).toBeGreaterThanOrEqual(1);
    for (const entry of messages) {
      expect(entry.content).not.toContain(marker);
      expect(entry.content).toBe(REDACTED);
    }
    const assistant = messages.find((entry) => entry.role.toUpperCase() === 'ASSISTANT');
    expect(assistant, 'the redacted run kept no assistant message row').toBeDefined();
    // Redaction removes text, never the accounting.
    expect(
      typeof assistant?.inputTokens === 'number' || typeof assistant?.outputTokens === 'number',
    ).toBe(true);
    const meter = await until(
      () => request('/auth/me/usage', usageSchema),
      (value) => value.day.used > dayUsedBefore,
      60_000,
      3_000,
    );
    expect(meter.day.used, 'the usage meter did not move for a zero-retention run').toBeGreaterThan(
      dayUsedBefore,
    );
    // The per-surface breakdown reads the durable ledger, not the meter.
    const sections = await fetchAccountUsageSections(request);
    if ((sections.account?.totals.requests ?? 0) <= usageBefore) {
      defects.push(
        'GET /auth/me/usage/breakdown did not count the runs of this account although /auth/me/usage did (no weighted_usage_records rows for the account)',
      );
    }
  }, 500_000);

  it('zero retention: a routed chat turn (POST /chat-messages) is redacted too', async () => {
    const marker = `zdr-chat-${randomUUID()}`;
    const thread = await newThread(true, 'ignored');
    const reply = await zdrRequest('/chat-messages', messageSchema, {
      method: 'POST',
      body: {
        threadId: thread.id,
        content: `Reply with the single word pong. ${marker}`,
        routingMode: 'MANUAL_MODEL',
        provider: LIVE_PROVIDER,
        model: LIVE_MODEL,
      },
    });
    expect(reply.threadId).toBe(thread.id);
    const messages = await until(
      () => listMessages(request, thread.id, 50),
      (list) => list.length >= 2 && list.every((entry) => entry.content === REDACTED),
      90_000,
    );
    for (const entry of messages) expect(entry.content).not.toContain(marker);
    expect(messages.every((entry) => entry.content === REDACTED)).toBe(true);
    const page = await request(`/chat-messages/thread/${thread.id}?limit=5`, messagePageSchema);
    expect(page.data.length).toBeGreaterThan(0);
  }, 300_000);
});
