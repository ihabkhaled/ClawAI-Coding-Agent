import { z } from 'zod';

import { MAX_MCP_SERVER_NAME_LENGTH, MAX_MCP_SERVERS, MCP_LOOPBACK_HOSTS } from './mcp.constants';

import type { McpConfigLoad, McpServerConfig, McpServerOrigin } from './mcp.types';

/**
 * A URL an MCP connection or OAuth exchange may use: `https:` anywhere, `http:`
 * only on the loopback interface. A bearer token sent over plain HTTP to a
 * remote host is a token handed to every hop on the way.
 */
export function isAdmissibleMcpUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' && (MCP_LOOPBACK_HOSTS as readonly string[]).includes(url.hostname)
  );
}

const mcpUrlSchema = z
  .string()
  .min(8)
  .max(2_048)
  .refine(isAdmissibleMcpUrl, 'MCP URLs must be https, or http on localhost');

export const mcpServerNameSchema = z
  .string()
  .min(1)
  .max(MAX_MCP_SERVER_NAME_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);

export const mcpStdioServerSchema = z
  .object({
    type: z.literal('stdio').optional(),
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(8_192)).max(200).default([]),
    env: z.record(z.string().min(1).max(200), z.string().max(8_192)).default({}),
    /** Relative to the workspace root; absent means the root itself. */
    cwd: z.string().min(1).max(4_096).optional(),
  })
  .strict();

export const mcpOAuthSchema = z
  .object({
    clientId: z.string().min(1).max(500),
    /** Discovered from the server origin's metadata when absent. */
    authorizationEndpoint: mcpUrlSchema.optional(),
    tokenEndpoint: mcpUrlSchema.optional(),
    scopes: z.array(z.string().min(1).max(200)).max(50).default([]),
    /** RFC 8707 resource indicator; defaults to the server URL. */
    resource: mcpUrlSchema.optional(),
  })
  .strict();

/**
 * `headers` may not carry credentials. A token belongs in SecretStorage, which
 * the OAuth flow writes; a token in a JSON file is a token in a repository.
 */
const safeHeaderName = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (name) => !/^(?:authorization|cookie|proxy-authorization)$/iu.test(name),
    'Credentials may not be configured as MCP headers',
  );

export const mcpHttpServerSchema = z
  .object({
    type: z.enum(['http', 'streamable-http']).optional(),
    url: mcpUrlSchema,
    headers: z.record(safeHeaderName, z.string().max(2_048)).default({}),
    oauth: mcpOAuthSchema.optional(),
  })
  .strict();

export const mcpServerEntrySchema = z.union([mcpStdioServerSchema, mcpHttpServerSchema]);

/** Accepts `servers` and, for files written for other MCP clients, `mcpServers`. */
export const mcpConfigFileSchema = z
  .object({
    servers: z.record(mcpServerNameSchema, mcpServerEntrySchema).optional(),
    mcpServers: z.record(mcpServerNameSchema, mcpServerEntrySchema).optional(),
  })
  .strict();

function toServer(
  name: string,
  entry: z.infer<typeof mcpServerEntrySchema>,
  origin: McpServerOrigin,
): McpServerConfig {
  if ('command' in entry) {
    return {
      name,
      origin,
      transport: 'stdio',
      command: entry.command,
      args: entry.args,
      env: entry.env,
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
    };
  }
  return {
    name,
    origin,
    transport: 'http',
    url: entry.url,
    headers: entry.headers,
    ...(entry.oauth === undefined ? {} : { oauth: entry.oauth }),
  };
}

/**
 * Parses one configuration source. A malformed source contributes nothing and
 * reports why, so one bad file never hides the servers another source declares.
 */
export function parseMcpConfig(candidate: unknown, origin: McpServerOrigin): McpConfigLoad {
  if (candidate === undefined || candidate === null) return { servers: [], errors: [] };
  const parsed = mcpConfigFileSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '' : issue.path.join('.');
    return {
      servers: [],
      errors: [`${origin} MCP configuration is invalid at "${where}": ${issue?.message ?? ''}`],
    };
  }
  const entries = { ...parsed.data.mcpServers, ...parsed.data.servers };
  return {
    servers: Object.entries(entries).map(([name, entry]) => toServer(name, entry, origin)),
    errors: [],
  };
}

/**
 * User-level servers win a name collision. A workspace file is untrusted
 * content, and letting it redefine a server the user configured would let a
 * cloned repository swap the command behind a name the user already approved.
 */
export function mergeMcpConfigs(user: McpConfigLoad, workspace: McpConfigLoad): McpConfigLoad {
  const names = new Set(user.servers.map((server) => server.name));
  const shadowed = workspace.servers.filter((server) => names.has(server.name));
  const servers = [
    ...user.servers,
    ...workspace.servers.filter((server) => !names.has(server.name)),
  ];
  const errors = [
    ...user.errors,
    ...workspace.errors,
    ...shadowed.map(
      (server) => `workspace MCP server "${server.name}" is ignored: a user server has that name`,
    ),
  ];
  if (servers.length > MAX_MCP_SERVERS) {
    errors.push(`Only the first ${String(MAX_MCP_SERVERS)} MCP servers are loaded`);
  }
  return { servers: servers.slice(0, MAX_MCP_SERVERS), errors };
}
