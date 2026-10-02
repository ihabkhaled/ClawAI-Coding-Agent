import { describe, expect, it } from 'vitest';

import { deferredDefinitionHash as extensionHash } from '../../src/core/runtime/runtime-deferred-tools';
import { parseToolDefinition } from '../../src/core/runtime/runtime-tool-contracts';
import { sha256 } from '../../src/headless/headless-transport';
import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { runAgent } from '../../src/sdk/agent-sdk';
import { deferredToolkit } from '../../src/sdk/deferred-toolkit';
import {
  deferredDefinitionHash,
  searchDeferred,
  splitCatalog,
  stubSummary,
} from '../../src/sdk/deferred-tools';
import { DEFERRED_TOOL_SEARCH_NAME } from '../../src/sdk/deferred-tools.constants';
import { definitionsFor } from '../../src/sdk/tool-catalog-scenarios';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentToolkit, RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { WireToolDefinition } from '../../src/sdk/deferred-tools.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

function fail(message: string): never {
  throw new Error(message);
}

const ALL: readonly AgentToolCategory[] = ['read', 'write', 'command', 'git', 'browser', 'agents'];

function wire(): readonly WireToolDefinition[] {
  return definitionsFor(ALL, true) as readonly WireToolDefinition[];
}

function request(toolName: string, operation: string, args: unknown): HeadlessStreamEvent {
  return {
    type: 'tool.requested',
    payload: { invocationId: 'inv-1', toolName, operation, invocation: { arguments: args } },
  };
}

interface Seen {
  started: { toolCatalogHash: string; toolDefinitions: readonly unknown[] }[];
  loaded: unknown[][];
  results: { status?: string; structured?: Record<string, unknown> }[];
}

function transport(
  events: readonly HeadlessStreamEvent[],
  seen: Seen,
  options: { rejectStubs?: boolean; withLoader?: boolean } = {},
): RuntimeTransportPort {
  return {
    signIn: () => Promise.resolve('token'),
    createThread: () => Promise.resolve('thread-1'),
    startRun: (_token, body) => {
      if (
        options.rejectStubs === true &&
        JSON.stringify(body.toolDefinitions).includes('"deferred"')
      ) {
        return Promise.reject(new RuntimeHttpError('/runs', 400, 'invalid'));
      }
      seen.started.push(body);
      return Promise.resolve({ runId: 'run-1', generation: 'gen-1' });
    },
    submitResult: (_t, _r, _e, result) => {
      seen.results.push(result as Seen['results'][number]);
      return Promise.resolve({});
    },
    events: async function* stream() {
      for (const event of events) yield await Promise.resolve(event);
    },
    ...(options.withLoader === false
      ? {}
      : {
          loadTools: (_t: string, _r: unknown, definitions: readonly unknown[]) => {
            seen.loaded.push([...definitions]);
            return Promise.resolve({
              catalogVersion: 2,
              loaded: (definitions as WireToolDefinition[]).map((d) => ({
                name: d.name,
                version: d.version,
              })),
            });
          },
        }),
  };
}

function inner(): AgentToolkit & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    definitions: wire(),
    execute: (call) => {
      calls.push(`${call.toolName}.${call.operation}`);
      return { ran: true };
    },
    authorize: (call) => call.toolName !== 'agent.team',
  };
}

const credentials = { email: 'a@b.c', password: 'x' };

describe('deferred tool catalog', () => {
  it('sends stubs that commit to the full definition, with the backend hash rule', () => {
    const full = wire();
    const { wire: sent, deferred } = splitCatalog(full);
    const stub = (sent as { name: string; deferred?: { definitionHash: string } }[]).find(
      (entry) => entry.name === 'browser.page',
    );
    const original = full.find((entry) => entry.name === 'browser.page');

    expect(deferred.map((entry) => entry.name)).toContain('browser.page');
    expect(stub?.deferred?.definitionHash).toBe(
      deferredDefinitionHash(original ?? fail('browser.page is offered')),
    );
    // The extension implements the same rule against the same chat-service check.
    expect(stub?.deferred?.definitionHash).toBe(extensionHash(parseToolDefinition(original)));
  });

  it('keeps the stub valid for the backend schema and small', () => {
    const { wire: sent } = splitCatalog(wire());

    for (const entry of sent as { deferred?: unknown }[]) {
      const { deferred, ...rest } = entry as { deferred?: unknown } & Record<string, unknown>;
      expect(() => parseToolDefinition(rest)).not.toThrow();
      if (deferred !== undefined) {
        expect(JSON.stringify(entry).length).toBeLessThan(560);
        expect((entry as { inputSchema: unknown }).inputSchema).toEqual({ type: 'object' });
      }
    }
  });

  it('defers nothing, and offers no search tool, when nothing deferrable is offered', () => {
    const small = definitionsFor(['read', 'git'], false);
    const split = splitCatalog(small);

    expect(split.deferred).toEqual([]);
    expect(split.wire).toBe(small);
    expect(JSON.stringify(split.wire)).not.toContain(DEFERRED_TOOL_SEARCH_NAME);
  });

  it('keeps the everyday tools whole', () => {
    const names = (splitCatalog(wire()).wire as { name: string; deferred?: unknown }[])
      .filter((entry) => entry.deferred === undefined)
      .map((entry) => entry.name);

    expect(names).toEqual(
      expect.arrayContaining(['workspace.file', 'workspace.command', 'workspace.git']),
    );
    expect(names).toContain(DEFERRED_TOOL_SEARCH_NAME);
  });

  it('finds a tool by exact name or by keyword', () => {
    const { deferred } = splitCatalog(wire());

    expect(searchDeferred('browser.page', deferred).map((d) => d.name)).toEqual(['browser.page']);
    expect(searchDeferred('screenshot', deferred).map((d) => d.name)).toContain('browser.page');
    expect(searchDeferred('zz', deferred)).toEqual([]);
    expect(stubSummary(deferred.at(0) ?? fail('something is deferred')).length).toBeGreaterThan(10);
  });
});

describe('a run with deferred tools', () => {
  it('starts with stubs, hashes what it sent, and loads a tool when the model asks', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    const toolkit = inner();
    await runAgent({
      prompt: 'p',
      toolkit,
      credentials,
      deferTools: true,
      transport: transport(
        [
          request(DEFERRED_TOOL_SEARCH_NAME, 'search', { query: 'browser.page' }),
          request('browser.page', 'open', { url: 'http://x' }),
          { type: 'run.completed' },
        ],
        seen,
      ),
    });

    const [start] = seen.started;
    expect(JSON.stringify(start?.toolDefinitions).length).toBeLessThan(
      JSON.stringify(toolkit.definitions).length * 0.7,
    );
    expect(start?.toolCatalogHash).toBe(sha256(JSON.stringify(start?.toolDefinitions)));
    expect(seen.loaded).toHaveLength(1);
    expect((seen.loaded[0]?.[0] as WireToolDefinition).name).toBe('browser.page');
    expect(seen.loaded[0]?.[0]).toBe(
      toolkit.definitions.find((d) => (d as WireToolDefinition).name === 'browser.page'),
    );
    const search = seen.results[0]?.structured as {
      loaded: { name: string }[];
      stillDeferred: { name: string }[];
    };
    expect(search.loaded.map((entry) => entry.name)).toEqual(['browser.page']);
    expect(search.stillDeferred.map((entry) => entry.name)).not.toContain('browser.page');
    expect(toolkit.calls).toEqual(['browser.page.open']);
  });

  it('still refuses a loaded tool the permissions deny', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    const toolkit = inner();
    await runAgent({
      prompt: 'p',
      toolkit,
      credentials,
      deferTools: true,
      transport: transport(
        [
          request(DEFERRED_TOOL_SEARCH_NAME, 'search', { query: 'agent.team' }),
          request('agent.team', 'spawn', { name: 'a', task: 'b' }),
          { type: 'run.completed' },
        ],
        seen,
      ),
    });

    expect(toolkit.calls).toEqual([]);
    expect(seen.results[1]).toMatchObject({ status: 'failed' });
  });

  it('answers a search for nothing with what is still deferred, loading nothing', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    await runAgent({
      prompt: 'p',
      toolkit: inner(),
      credentials,
      deferTools: true,
      transport: transport(
        [
          request(DEFERRED_TOOL_SEARCH_NAME, 'search', { query: 'qqqq' }),
          { type: 'run.completed' },
        ],
        seen,
      ),
    });

    const out = seen.results[0]?.structured as { loaded: unknown[]; stillDeferred: unknown[] };
    expect(seen.loaded).toEqual([]);
    expect(out.loaded).toEqual([]);
    expect(out.stillDeferred.length).toBeGreaterThan(3);
  });

  it('rejects a search with no query as a failed result, not a crash', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    const result = await runAgent({
      prompt: 'p',
      toolkit: inner(),
      credentials,
      deferTools: true,
      transport: transport(
        [request(DEFERRED_TOOL_SEARCH_NAME, 'search', {}), { type: 'run.completed' }],
        seen,
      ),
    });

    expect(result.outcome).toBe('completed');
    expect(seen.results[0]).toMatchObject({ status: 'failed' });
  });

  it('falls back to the whole catalog once when the backend rejects stubs', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    const toolkit = inner();
    await runAgent({
      prompt: 'p',
      toolkit,
      credentials,
      deferTools: true,
      transport: transport([{ type: 'run.completed' }], seen, { rejectStubs: true }),
    });

    expect(seen.started).toHaveLength(1);
    expect(seen.started[0]?.toolDefinitions).toBe(toolkit.definitions);
  });

  it('sends the whole catalog when the transport cannot load tools or the flag is off', async () => {
    for (const [deferTools, withLoader] of [
      [true, false],
      [undefined, true],
    ] as const) {
      const seen: Seen = { started: [], loaded: [], results: [] };
      const toolkit = inner();
      await runAgent({
        prompt: 'p',
        toolkit,
        credentials,
        deferTools,
        transport: transport([{ type: 'run.completed' }], seen, { withLoader }),
      });

      expect(seen.started[0]?.toolDefinitions).toBe(toolkit.definitions);
    }
  });

  it('does not let a search add anything the run never declared', async () => {
    const seen: Seen = { started: [], loaded: [], results: [] };
    const kit = deferredToolkit(inner(), splitCatalog(wire()), { current: undefined });
    const out = (await kit.execute({
      toolName: DEFERRED_TOOL_SEARCH_NAME,
      operation: 'search',
      arguments: { query: 'workspace.file' },
    })) as { loaded: unknown[] };

    expect(out.loaded).toEqual([]);
    expect(seen.loaded).toEqual([]);
  });
});
