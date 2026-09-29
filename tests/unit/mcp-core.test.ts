import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyJsonRpc,
  jsonRpcErrorResponse,
  jsonRpcResultResponse,
  parseJsonSafely,
  parseServerSentEvents,
} from '../../src/core/mcp/json-rpc';
import {
  isAdmissibleMcpUrl,
  mcpConfigFileSchema,
  mergeMcpConfigs,
  parseMcpConfig,
} from '../../src/core/mcp/mcp-config';
import {
  classifyMcpOperation,
  mcpPolicySubject,
} from '../../src/core/mcp/mcp-policy-classification';
import {
  assertSupportedProtocol,
  boundText,
  summarizeCallResult,
  summarizeTools,
} from '../../src/core/mcp/mcp-protocol';
import {
  admitMcpServers,
  mcpServerMatches,
  readMcpServerPolicy,
} from '../../src/core/mcp/mcp-server-policy';
import { MAX_MCP_SERVERS } from '../../src/core/mcp/mcp.constants';
import { projectPolicySchema } from '../../src/core/policy-v2';

import type { McpServerConfig } from '../../src/core/mcp/mcp.types';

const stdio: McpServerConfig = {
  name: 'files',
  origin: 'workspace',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: {},
};
const http: McpServerConfig = {
  name: 'github',
  origin: 'user',
  transport: 'http',
  url: 'https://api.github.test/mcp',
  headers: {},
};

describe('MCP configuration', () => {
  it('admits https anywhere and http only on loopback', () => {
    expect(isAdmissibleMcpUrl('https://example.test/mcp')).toBe(true);
    expect(isAdmissibleMcpUrl('http://127.0.0.1:3000/mcp')).toBe(true);
    expect(isAdmissibleMcpUrl('http://localhost/mcp')).toBe(true);
    expect(isAdmissibleMcpUrl('http://example.test/mcp')).toBe(false);
    expect(isAdmissibleMcpUrl('https://user:pw@example.test/')).toBe(false);
    expect(isAdmissibleMcpUrl('not a url')).toBe(false);
  });

  it('parses stdio and http servers from either key', () => {
    const load = parseMcpConfig(
      {
        servers: { local: { command: 'node', args: ['s.js'], cwd: 'tools' } },
        mcpServers: {
          remote: { type: 'http', url: 'https://x.test/mcp', oauth: { clientId: 'c' } },
        },
      },
      'workspace',
    );
    expect(load.errors).toEqual([]);
    expect(load.servers).toEqual([
      expect.objectContaining({ name: 'remote', transport: 'http', oauth: expect.anything() }),
      expect.objectContaining({ name: 'local', transport: 'stdio', cwd: 'tools', env: {} }),
    ]);
  });

  it('reports an invalid file instead of throwing, and refuses credential headers', () => {
    const load = parseMcpConfig(
      { servers: { bad: { url: 'https://x.test', headers: { Authorization: 'Bearer x' } } } },
      'workspace',
    );
    expect(load.servers).toEqual([]);
    expect(load.errors[0]).toContain('workspace MCP configuration is invalid');
    expect(parseMcpConfig(undefined, 'user')).toEqual({ servers: [], errors: [] });
    expect(
      parseMcpConfig({ servers: { x: { url: 'http://remote.test' } } }, 'user').servers,
    ).toEqual([]);
  });

  it('lets a user server win a name clash and caps the server count', () => {
    const user = { servers: [{ ...http, name: 'files' }], errors: [] };
    const workspace = { servers: [stdio, { ...stdio, name: 'other' }], errors: ['w'] };
    const merged = mergeMcpConfigs(user, workspace);
    expect(merged.servers.map((server) => server.name)).toEqual(['files', 'other']);
    expect(merged.servers[0]?.origin).toBe('user');
    expect(merged.errors).toEqual(['w', expect.stringContaining('"files" is ignored')]);
    const many = Array.from({ length: MAX_MCP_SERVERS + 1 }, (_, index) => ({
      ...stdio,
      name: `s${String(index)}`,
    }));
    const capped = mergeMcpConfigs({ servers: many, errors: [] }, { servers: [], errors: [] });
    expect(capped.servers).toHaveLength(MAX_MCP_SERVERS);
    expect(capped.errors[0]).toContain('Only the first');
  });

  it('ships a JSON schema offering exactly the keys the validator accepts', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'schemas', 'clawai-mcp.schema.json'), 'utf8'),
    ) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(mcpConfigFileSchema.shape).sort(),
    );
  });
});

describe('MCP server allow and deny (F054)', () => {
  it('matches on name, command and url globs', () => {
    expect(mcpServerMatches({ name: 'git*' }, http)).toBe(true);
    expect(mcpServerMatches({ command: 'npx *server-filesystem' }, stdio)).toBe(true);
    expect(mcpServerMatches({ command: 'npx*' }, http)).toBe(false);
    expect(mcpServerMatches({ url: 'https://api.github.test/*' }, http)).toBe(true);
    expect(mcpServerMatches({ url: '*' }, stdio)).toBe(false);
    expect(mcpServerMatches({ name: 'x' }, stdio)).toBe(false);
  });

  it('lets deny win over allow and reports who refused', () => {
    const result = admitMcpServers(
      [stdio, http],
      {
        organization: { allow: [{ name: '*' }], deny: [{ name: 'files', reason: 'No local FS' }] },
        project: { allow: [{ name: 'github' }], deny: [] },
      },
      true,
    );
    expect(result.admitted.map((server) => server.name)).toEqual(['github']);
    expect(result.refused).toEqual([
      { name: 'files', code: 'MCP_SERVER_DENIED', source: 'organization', reason: 'No local FS' },
    ]);
  });

  it('refuses servers outside a non-empty allowlist, and stdio in untrusted workspaces', () => {
    const allowOnly = admitMcpServers(
      [http],
      { project: { allow: [{ name: 'x' }], deny: [] } },
      true,
    );
    expect(allowOnly.refused[0]).toMatchObject({
      code: 'MCP_SERVER_NOT_ALLOWED',
      source: 'project',
    });
    const denyProject = admitMcpServers(
      [http],
      { project: { allow: [], deny: [{ name: '*' }] } },
      true,
    );
    expect(denyProject.refused[0]?.reason).toContain('project policy denies');
    const untrusted = admitMcpServers([stdio, http], {}, false);
    expect(untrusted.admitted).toEqual([http]);
    expect(untrusted.refused[0]?.code).toBe('MCP_WORKSPACE_UNTRUSTED');
  });

  it('reads a malformed policy as deny-everything, and an absent one as none', () => {
    expect(readMcpServerPolicy(undefined)).toBeUndefined();
    expect(readMcpServerPolicy(null)).toBeUndefined();
    expect(readMcpServerPolicy({ deny: [{}] })?.deny[0]?.name).toBe('*');
    expect(readMcpServerPolicy({ allow: [{ url: 'https://*' }] })?.allow).toHaveLength(1);
  });

  it('is part of the project policy file', () => {
    const policy = projectPolicySchema.parse({ mcpServers: { deny: [{ command: 'curl *' }] } });
    expect(policy.mcpServers?.deny[0]?.command).toBe('curl *');
    expect(() => projectPolicySchema.parse({ mcpServers: { allow: [{ reason: 'r' }] } })).toThrow();
  });
});

describe('JSON-RPC framing', () => {
  it('classifies responses, requests, notifications and noise', () => {
    expect(classifyJsonRpc({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toEqual({
      kind: 'response',
      id: 1,
      result: { ok: true },
    });
    expect(
      classifyJsonRpc({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'boom' } }),
    ).toEqual({ kind: 'response', id: 2, error: { code: -1, message: 'boom' } });
    expect(classifyJsonRpc({ jsonrpc: '2.0', id: 'a', method: 'ping' })).toEqual({
      kind: 'request',
      id: 'a',
      method: 'ping',
    });
    expect(classifyJsonRpc({ jsonrpc: '2.0', method: 'notifications/x' })).toEqual({
      kind: 'notification',
      method: 'notifications/x',
    });
    expect(classifyJsonRpc('junk')).toEqual({ kind: 'invalid' });
    expect(parseJsonSafely('{')).toBeUndefined();
    expect(JSON.parse(jsonRpcErrorResponse(1, -32601, 'no'))).toMatchObject({
      error: { code: -32601 },
    });
    expect(JSON.parse(jsonRpcResultResponse('x', {}))).toMatchObject({ id: 'x', result: {} });
  });

  it('extracts SSE data payloads, joining multi-line data', () => {
    expect(
      parseServerSentEvents('event: message\ndata: {"a":1}\n\ndata: x\ndata: y\n\n: c\n'),
    ).toEqual(['{"a":1}', 'x\ny']);
  });
});

describe('MCP protocol shaping', () => {
  it('rejects an unsupported negotiated revision', () => {
    expect(() => {
      assertSupportedProtocol({ protocolVersion: '2099-01-01' });
    }).toThrow('unsupported protocol');
    expect(() => {
      assertSupportedProtocol({ protocolVersion: '2025-03-26' });
    }).not.toThrow();
  });

  it('bounds and redacts tool listings and results, and drops binary parts', () => {
    const tools = summarizeTools([
      { name: 't', description: `api_key=supersecret ${'d'.repeat(5_000)}`, inputSchema: { a: 1 } },
      { name: 'u' },
    ]);
    expect(tools[0]?.description).not.toContain('supersecret');
    expect(tools[0]?.description.length).toBeLessThanOrEqual(1_000);
    expect(tools[1]).toEqual({ name: 'u', description: '', inputSchema: '{}' });

    const result = summarizeCallResult({
      content: [
        { type: 'text', text: 'Bearer abc.def' },
        { type: 'resource', resource: { uri: 'file:///a', text: 'body' } },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'audio' },
      ],
      structuredContent: { password: 'p', value: 3 },
      isError: true,
    });
    expect(result.text).toContain('Bearer [REDACTED]');
    expect(result.text).toContain('[resource file:///a]\nbody');
    expect(result.text).toContain('"password":"[REDACTED]"');
    expect(result.omittedParts).toEqual(['image (image/png)', 'audio']);
    expect(result.isError).toBe(true);
    expect(boundText('x'.repeat(100), 80)).toMatchObject({ truncated: true });
    expect(
      summarizeCallResult({ content: [{ type: 'text', text: 'y'.repeat(60_000) }] }).truncated,
    ).toBe(true);
  });
});

describe('MCP policy classification', () => {
  it('classifies servers as a read and tools/call as R3', () => {
    expect(classifyMcpOperation('servers')).toEqual({
      effect: 'read',
      risk: 'R0',
      reversible: true,
    });
    expect(classifyMcpOperation('tools').risk).toBe('R3');
    expect(classifyMcpOperation('call')).toEqual({
      effect: 'network-write',
      risk: 'R3',
      reversible: false,
    });
  });

  it('exposes the server and tool as the command a project rule matches', () => {
    expect(mcpPolicySubject('call', 'runtime.mcp', { server: 'gh', tool: 'issues' }).command).toBe(
      'mcp gh issues',
    );
    expect(mcpPolicySubject('servers', 'runtime.mcp', {}).command).toBe('mcp');
    expect(mcpPolicySubject('tools', 'runtime.mcp', { server: 7 }).command).toBe('mcp');
  });
});
