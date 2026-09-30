import { homedir } from 'node:os';

import { McpOAuthService } from '../../services/mcp-oauth-service';

import { MCP_LOGIN_REQUIRED_MESSAGE } from './mcp-login.constants';
import { openLoopbackCallback } from './mcp-loopback';
import { defaultTokenFile, fileTokenStore, memoryTokenStore } from './mcp-token-file';

import type { McpFetch } from '../../infrastructure/mcp/mcp-transport.types';
import type { AgentMcpOptions } from '../../sdk/mcp-toolkit.types';
import type { McpSecretStore } from '../../services/mcp-oauth-service.types';
import type { HeadlessEnvironment, HeadlessInvocation } from '../headless-args.types';

const globalFetch: McpFetch = (input, init) => fetch(input, init);

/** The interactive half of a sign-in: where the URL goes, and how long to wait. */
export interface McpLoginPrompt {
  readonly show: (url: string) => void;
  readonly timeoutMs: number;
}

export interface McpOAuthOptions {
  readonly store: McpSecretStore;
  readonly fetch?: McpFetch | undefined;
  readonly now?: (() => number) | undefined;
  /** Absent for a run: a run refreshes a token but never opens a browser. */
  readonly prompt?: McpLoginPrompt | undefined;
}

/**
 * The extension's own OAuth service over a host-free store and listener, so the
 * token key (server URL, client id, both endpoints, resource) and the refresh
 * rules are the same code, not a copy.
 */
export function createMcpOAuth(options: McpOAuthOptions): McpOAuthService {
  const prompt = options.prompt;
  return new McpOAuthService({
    secrets: options.store,
    callbacks: {
      open: (state) =>
        prompt === undefined
          ? Promise.reject(new Error(MCP_LOGIN_REQUIRED_MESSAGE))
          : openLoopbackCallback(state, prompt.timeoutMs),
    },
    openBrowser: (url) => {
      prompt?.show(url);
      return Promise.resolve(true);
    },
    fetch: options.fetch ?? globalFetch,
    now: options.now ?? ((): number => Date.now()),
  });
}

/** Where tokens for this invocation live: the per-user file, or a given file. */
export function tokenFileFor(
  tokenFile: string | undefined,
  environment: HeadlessEnvironment,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  return tokenFile ?? defaultTokenFile(environment, platform, home);
}

/**
 * MCP options for a run, with OAuth tokens attached.
 *
 * Without `--mcp-token-file` tokens come from the per-user file and a refresh is
 * written back. With it the file is read-only input and a refresh stays in
 * memory. Either way a run never starts a sign-in.
 */
export function withMcpTokens(
  mcp: AgentMcpOptions,
  invocation: Pick<HeadlessInvocation, 'mcpTokenFile'>,
  environment: HeadlessEnvironment,
): AgentMcpOptions {
  const store =
    invocation.mcpTokenFile === undefined
      ? fileTokenStore(tokenFileFor(undefined, environment))
      : memoryTokenStore(invocation.mcpTokenFile);
  const service = createMcpOAuth({ store });
  return { ...mcp, tokens: (server) => service.tokenProvider(server) };
}
