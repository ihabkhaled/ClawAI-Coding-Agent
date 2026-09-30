import { homedir } from 'node:os';

import { headlessExitCode } from '../../core/headless-outcome';
import { parseMcpConfig } from '../../core/mcp/mcp-config';
import { admitMcpServers, readMcpServerPolicy } from '../../core/mcp/mcp-server-policy';
import { MCP_OAUTH_TIMEOUT_MS } from '../../core/mcp/mcp.constants';
import { redactText } from '../../core/redaction';
import { mcpOf } from '../headless-inputs';

import { createMcpOAuth, tokenFileFor } from './mcp-login-service';
import { fileTokenStore } from './mcp-token-file';

import type { HeadlessLogin, McpLoginContext } from './mcp-login.types';
import type { McpHttpServerConfig } from '../../core/mcp/mcp.types';
import type { HeadlessEnvironment, HeadlessIo } from '../headless-args.types';

/** The named server as a server that can sign in, or the sentence saying why it cannot. */
async function loginServer(login: HeadlessLogin): Promise<McpHttpServerConfig | string> {
  const mcp = await mcpOf(login.mcpConfig);
  const load = parseMcpConfig(mcp.config, 'user');
  const server = load.servers.find((candidate) => candidate.name === login.server);
  if (server === undefined) return `The MCP config has no server named "${login.server}".`;
  if (server.transport !== 'http' || server.oauth === undefined) {
    return `MCP server "${login.server}" is not configured with oauth, so there is nothing to sign in to.`;
  }
  const policy = readMcpServerPolicy(mcp.policy);
  const admission = admitMcpServers(
    [server],
    policy === undefined ? {} : { project: policy },
    true,
  );
  return admission.refused[0]?.reason ?? server;
}

/**
 * `clawai --mcp-login <server>`: the OAuth 2.1 authorization-code flow with
 * PKCE, without an editor.
 *
 * Prints the authorization URL and, only when a terminal is attached, hands it
 * to the platform opener. The token is stored in the per-user 0600 file (or the
 * one `--mcp-token-file` names) and is never printed. Exit 0 signed in, 1 the
 * sign-in failed, 2 the server cannot be signed in to.
 */
export async function runMcpLogin(
  login: HeadlessLogin,
  environment: HeadlessEnvironment,
  io: HeadlessIo,
  context: McpLoginContext,
): Promise<number> {
  const usage = (message: string): number => {
    io.stderr(`${message}\n`);
    return headlessExitCode('unusable');
  };
  let server: McpHttpServerConfig | string;
  try {
    server = await loginServer(login);
  } catch (error) {
    return usage(error instanceof Error ? error.message : 'The MCP config could not be read.');
  }
  if (typeof server === 'string') return usage(server);
  const file = tokenFileFor(
    login.tokenFile,
    environment,
    context.platform ?? process.platform,
    context.home ?? homedir(),
  );
  const service = createMcpOAuth({
    store: fileTokenStore(file),
    fetch: context.fetch,
    now: context.now,
    prompt: {
      timeoutMs: context.timeoutMs ?? MCP_OAUTH_TIMEOUT_MS,
      show: (url) => {
        io.stdout(`Open this URL to authorize "${server.name}":\n${url}\n`);
        context.openUrl?.(url);
      },
    },
  });
  try {
    await service.forget(server);
    const token = await service.tokenProvider(server).renew(context.signal);
    if (token === undefined) throw new Error('The sign-in produced no token.');
  } catch (error) {
    io.stderr(`${redactText(error instanceof Error ? error.message : 'Sign-in failed')}\n`);
    return headlessExitCode('failed');
  }
  io.stdout(`Signed in to "${server.name}". Token stored in ${file}\n`);
  return headlessExitCode('completed');
}
