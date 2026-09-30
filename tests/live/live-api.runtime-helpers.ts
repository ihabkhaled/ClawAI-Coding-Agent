import { randomUUID } from 'node:crypto';

import { BackendRuntimeClient } from '../../src/backend/backend-runtime-client';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { createThread } from '../../src/backend/thread-client';
import { deferRuntimeCatalog } from '../../src/core/runtime/runtime-deferred-tools';

import {
  LIVE_MODEL,
  LIVE_PROVIDER,
  onCleanup,
  rawCall,
  request,
  sha256,
  until,
  zdrRequest,
} from './live-api.helpers';

import type { ToolDefinition } from '../../src/core/runtime/runtime-tool-contracts';

export const RUN_END_MS = 240_000;
export const EPOCHS = { account: 1, workspace: 1, target: 1, policy: 1 } as const;
export const REDACTED = '[not retained: zero data retention]';

const BUDGET = {
  maxModelTurns: 2,
  maxToolCalls: 2,
  maxToolRounds: 2,
  maxRepairAttempts: 0,
  maxRuntimeMs: 120_000,
  maxOutputBytes: 65_536,
  maxToolResultBytes: 65_536,
} as const;

function definition(name: string, operations: string[], description: string): ToolDefinition {
  return {
    schemaVersion: '2.0',
    name,
    version: '2.0.0',
    description,
    operations,
    riskClasses: ['inspect'],
    targetIds: ['target:workspace'],
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  };
}

export const FILE_TOOL = definition('workspace.file', ['read'], 'Read one file.');
export const SEARCH_TOOL = definition('runtime.tool_search', ['search'], 'Find a deferred tool.');
export const NOTEBOOK_TOOL = definition('workspace.notebook', ['read'], 'Read one notebook cell.');

/** A run start built the way the extension builds one, with `workspace.notebook` deferred. */
export function startBody(threadId: string, prompt: string) {
  const catalog = deferRuntimeCatalog([FILE_TOOL, SEARCH_TOOL, NOTEBOOK_TOOL]);
  return {
    catalog,
    body: {
      schemaVersion: '2.0' as const,
      threadId,
      clientRequestId: `request.${randomUUID()}`,
      idempotencyKey: `idem.${randomUUID()}`,
      prompt,
      manifestHash: `sha256:${sha256(JSON.stringify({ targets: ['target:workspace'] }))}`,
      toolCatalogHash: `sha256:${sha256(JSON.stringify(catalog.wire))}`,
      toolDefinitions: catalog.wire,
      provider: LIVE_PROVIDER,
      model: LIVE_MODEL,
      epochs: EPOCHS,
      budget: BUDGET,
    },
  };
}

export function runtimeClient(zeroRetention: boolean): BackendRuntimeClient {
  return new BackendRuntimeClient(zeroRetention ? zdrRequest : request, async () => {
    throw new Error('the live lane does not open a stream through this client');
  });
}

/** A coding-agent thread, titled the way the extension titles one under zero retention. */
export async function newThread(zeroRetention: boolean, title: string) {
  const thread = await createThread(zeroRetention ? zdrRequest : request, {
    title: zeroRetention ? 'Private chat' : title,
    routingMode: 'MANUAL_MODEL',
    preferredProvider: LIVE_PROVIDER,
    preferredModel: LIVE_MODEL,
  });
  onCleanup(`thread ${thread.id}`, () => rawCall('DELETE', `/chat-threads/${thread.id}`));
  return thread;
}

export async function waitRunEnded(threadId: string): Promise<boolean> {
  const state = await until(
    () => remoteSessionClient.activeRun(request, threadId),
    (value) => !value.active,
    RUN_END_MS,
  );
  return !state.active;
}
