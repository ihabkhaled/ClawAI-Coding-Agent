import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseHeadlessArgs, parseToolList } from '../../src/headless/headless-args';
import { observedToolkit } from '../../src/sdk/observed-toolkit';
import { permissionsForMode } from '../../src/sdk/permission-modes';
import { toolCategory, workspaceToolkit } from '../../src/sdk/workspace-toolkit';
import { startTestServer } from '../helpers/http-test-server';

import type { AgentEvent } from '../../src/sdk/create-agent.types';
import type { AgentPermissions } from '../../src/sdk/workspace-toolkit.types';
import type { TestServer } from '../helpers/http-test-server';

let server: TestServer;
const workspace = mkdtempSync(path.join(tmpdir(), 'http-perm-'));

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
  rmSync(workspace, { recursive: true, force: true });
});

const call = (
  method: string,
  url = 'http://127.0.0.1:1/',
  extra: Record<string, unknown> = {},
) => ({
  toolName: 'http.request',
  operation: 'request',
  arguments: { method, url, ...extra },
});

function permissions(overrides: Partial<AgentPermissions> = {}): AgentPermissions {
  return {
    allow: ['read', 'git', 'http', 'http-write'],
    httpAllowHosts: ['127.0.0.1:1'],
    ...overrides,
  };
}

describe('http.request categories', () => {
  it('puts GET and HEAD in http and every other method, even a made-up one, in http-write', () => {
    expect(toolCategory(call('GET'))).toBe('http');
    expect(toolCategory(call('head'))).toBe('http');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT', '']) {
      expect(toolCategory(call(method))).toBe('http-write');
    }
    expect(toolCategory({ ...call('GET'), operation: 'send' })).toBeUndefined();
  });
});

describe('http.request offered and authorized', () => {
  const names = (toolkit: ReturnType<typeof workspaceToolkit>): string[] =>
    toolkit.definitions.map((definition) => (definition as { name: string }).name);

  it('is not offered without allowed hosts, which is the default', () => {
    expect(
      names(workspaceToolkit(workspace, { allow: ['read', 'git', 'http', 'http-write'] })),
    ).not.toContain('http.request');
  });

  it('is not offered without the http grant', () => {
    expect(
      names(workspaceToolkit(workspace, permissions({ allow: ['read', 'git'] }))),
    ).not.toContain('http.request');
  });

  it('is offered with a grant and hosts, and the description names the hosts', () => {
    const toolkit = workspaceToolkit(
      workspace,
      permissions({ httpAllowHosts: ['claw.local', '*.example.com'] }),
    );
    const definition = toolkit.definitions.find(
      (entry) => (entry as { name: string }).name === 'http.request',
    ) as { description: string };

    expect(definition.description).toContain('Allowed hosts: claw.local, *.example.com.');
  });

  it('refuses a bad host rule when the toolkit is built', () => {
    expect(() => workspaceToolkit(workspace, permissions({ httpAllowHosts: ['*'] }))).toThrow(
      /wildcard must be/u,
    );
  });

  it('denies a write method to a run granted only http, and allows its GET', async () => {
    const toolkit = workspaceToolkit(workspace, permissions({ allow: ['read', 'http'] }));

    expect(await toolkit.authorize?.(call('GET'))).toBe(true);
    expect(await toolkit.authorize?.(call('POST'))).toBe(false);
    expect(await toolkit.authorize?.(call('TRACE'))).toBe(false);
  });

  it('runs a granted call through the toolkit against a real server', async () => {
    const toolkit = workspaceToolkit(
      workspace,
      permissions({ httpAllowHosts: [`127.0.0.1:${String(server.port)}`] }),
    );

    const result = (await toolkit.execute(
      call('POST', `${server.origin}/echo`, { json: { a: 1 } }),
    )) as { ok: boolean; bodyText: string };

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.bodyText)).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });

  it('refuses a host that is not allowed through the toolkit with the allowed list', async () => {
    const toolkit = workspaceToolkit(
      workspace,
      permissions({ httpAllowHosts: [`127.0.0.1:${String(server.port)}`] }),
    );

    await expect(toolkit.execute(call('GET', 'http://127.0.0.1:9/'))).rejects.toThrow(
      /not an allowed host/u,
    );
  });
});

describe('http.request under each permission mode', () => {
  const asked: string[] = [];
  const approve = vi.fn(
    (request: { category: string; arguments: Readonly<Record<string, unknown>> }) => {
      asked.push(`${request.category}:${String(request.arguments.method)}`);
      return true;
    },
  );

  const toolkitIn = (mode: Parameters<typeof permissionsForMode>[0]) =>
    workspaceToolkit(workspace, permissionsForMode(mode, permissions({ approve })));

  it('plan: allows GET, blocks every mutating method', async () => {
    const toolkit = toolkitIn('plan');

    expect(await toolkit.authorize?.(call('GET'))).toBe(true);
    expect(await toolkit.authorize?.(call('DELETE'))).toBe(false);
    expect(await toolkit.authorize?.(call('POST'))).toBe(false);
  });

  it.each(['ask', 'strict', 'accept-edits', 'autonomous-scoped'] as const)(
    '%s: GET runs, a write is put to the approval callback',
    async (mode) => {
      asked.length = 0;
      const toolkit = toolkitIn(mode);

      expect(await toolkit.authorize?.(call('GET'))).toBe(true);
      expect(asked).toEqual([]);
      expect(await toolkit.authorize?.(call('POST'))).toBe(true);
      expect(asked).toEqual(['http-write:POST']);
    },
  );

  it.each(['ask', 'strict', 'accept-edits', 'autonomous-scoped'] as const)(
    '%s: a declined write does not run',
    async (mode) => {
      const toolkit = workspaceToolkit(
        workspace,
        permissionsForMode(mode, permissions({ approve: () => false })),
      );

      expect(await toolkit.authorize?.(call('PUT'))).toBe(false);
    },
  );

  it('a mode with no approval callback refuses writes', async () => {
    const toolkit = workspaceToolkit(workspace, permissionsForMode('ask', permissions()));

    expect(await toolkit.authorize?.(call('POST'))).toBe(false);
    expect(await toolkit.authorize?.(call('GET'))).toBe(true);
  });
});

describe('http.request and the event stream', () => {
  it('redacts credentials in the call event', async () => {
    const events: AgentEvent[] = [];
    const inner = workspaceToolkit(workspace, permissions());
    const toolkit = observedToolkit(inner, (event) => events.push(event), { denied: 0, calls: 0 });

    await toolkit.authorize?.(
      call('POST', 'http://127.0.0.1:1/login', {
        headers: { Authorization: 'Bearer abc.def.ghi-secret-value' },
        json: { password: 'pw-123456' },
      }),
    );

    const text = JSON.stringify(events);
    expect(text).not.toContain('abc.def.ghi-secret-value');
    expect(text).not.toContain('pw-123456');
    expect(text).toContain('http://127.0.0.1:1/login');
  });
});

describe('headless flags', () => {
  const cwd = path.resolve('/work');
  const parse = (argv: string[]) => parseHeadlessArgs(['-p', 'x', ...argv], {}, cwd);

  it('reads repeatable --http-allow-host and the http categories', () => {
    const parsed = parse([
      '--http-allow-host',
      'claw.local',
      '--http-allow-host',
      '127.0.0.1:3000,*.example.com',
      '--allow-tools',
      'read,http,http-write',
    ]);

    expect(parsed).toMatchObject({
      kind: 'run',
      invocation: {
        httpAllowHosts: ['claw.local', '127.0.0.1:3000', '*.example.com'],
        allowTools: ['read', 'http', 'http-write'],
      },
    });
  });

  it('has no hosts unless given', () => {
    expect(parse([])).toMatchObject({ kind: 'run', invocation: { allowTools: ['read', 'git'] } });
    const parsed = parse([]);
    expect(parsed.kind === 'run' && parsed.invocation.httpAllowHosts).toBeFalsy();
  });

  it('rejects a bare wildcard and a url with a clear message', () => {
    expect(parse(['--http-allow-host', '*'])).toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(/--http-allow-host: Host rule "\*"/u),
    });
    expect(parse(['--http-allow-host', 'https://claw.local'])).toMatchObject({ kind: 'usage' });
  });

  it('lists the http categories in the unknown-category message', () => {
    expect(parseToolList('nope')).toMatch(/http, http-write/u);
  });
});
