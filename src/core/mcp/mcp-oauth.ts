import { createHash } from 'node:crypto';

import { z } from 'zod';

import { isAdmissibleMcpUrl } from './mcp-config';
import {
  MCP_OAUTH_EXPIRY_MARGIN_MS,
  MCP_OAUTH_METADATA_PATH,
  MCP_OAUTH_SECRET_PREFIX,
} from './mcp.constants';

import type {
  McpAuthorizationEndpoints,
  McpHttpServerConfig,
  McpOAuthConfig,
  McpTokenSet,
} from './mcp.types';

const endpointSchema = z.string().max(2_048).refine(isAdmissibleMcpUrl);

export const authorizationServerMetadataSchema = z
  .object({ authorization_endpoint: endpointSchema, token_endpoint: endpointSchema })
  .loose();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(16_384),
    token_type: z.string().max(40).optional(),
    refresh_token: z.string().min(1).max(16_384).optional(),
    expires_in: z.number().int().positive().max(31_536_000).optional(),
  })
  .loose();

export const storedTokenSetSchema = z
  .object({
    accessToken: z.string().min(1).max(16_384),
    refreshToken: z.string().min(1).max(16_384).optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

/** RFC 8414 metadata lives at the origin of the server URL. */
export function authorizationMetadataUrl(serverUrl: string): string {
  return new URL(MCP_OAUTH_METADATA_PATH, new URL(serverUrl).origin).toString();
}

/** Configured endpoints win; discovery fills only what the configuration left out. */
export function resolveAuthorizationEndpoints(
  oauth: McpOAuthConfig,
  discovered: unknown,
): McpAuthorizationEndpoints {
  if (oauth.authorizationEndpoint !== undefined && oauth.tokenEndpoint !== undefined) {
    return {
      authorizationEndpoint: oauth.authorizationEndpoint,
      tokenEndpoint: oauth.tokenEndpoint,
    };
  }
  const metadata = authorizationServerMetadataSchema.parse(discovered);
  return {
    authorizationEndpoint: oauth.authorizationEndpoint ?? metadata.authorization_endpoint,
    tokenEndpoint: oauth.tokenEndpoint ?? metadata.token_endpoint,
  };
}

export function needsDiscovery(oauth: McpOAuthConfig): boolean {
  return oauth.authorizationEndpoint === undefined || oauth.tokenEndpoint === undefined;
}

export function buildAuthorizationUrl(input: {
  readonly endpoint: string;
  readonly server: McpHttpServerConfig;
  readonly oauth: McpOAuthConfig;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.oauth.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', input.state);
  url.searchParams.set('resource', input.oauth.resource ?? input.server.url);
  if (input.oauth.scopes.length > 0) url.searchParams.set('scope', input.oauth.scopes.join(' '));
  return url.toString();
}

export function authorizationCodeBody(input: {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly server: McpHttpServerConfig;
  readonly oauth: McpOAuthConfig;
}): string {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    client_id: input.oauth.clientId,
    resource: input.oauth.resource ?? input.server.url,
  }).toString();
}

export function refreshTokenBody(
  refreshToken: string,
  server: McpHttpServerConfig,
  oauth: McpOAuthConfig,
): string {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: oauth.clientId,
    resource: oauth.resource ?? server.url,
  }).toString();
}

/**
 * A refresh response that omits `refresh_token` keeps the previous one, as
 * RFC 6749 section 6 allows the server to do.
 */
export function parseTokenResponse(
  candidate: unknown,
  now: number,
  previousRefreshToken?: string,
): McpTokenSet {
  const response = tokenResponseSchema.parse(candidate);
  if (response.token_type !== undefined && response.token_type.toLowerCase() !== 'bearer') {
    throw new Error('MCP authorization server issued a token type other than bearer');
  }
  const refreshToken = response.refresh_token ?? previousRefreshToken;
  return {
    accessToken: response.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(response.expires_in === undefined ? {} : { expiresAt: now + response.expires_in * 1_000 }),
  };
}

export function isTokenFresh(tokens: McpTokenSet, now: number): boolean {
  return tokens.expiresAt === undefined || tokens.expiresAt - MCP_OAUTH_EXPIRY_MARGIN_MS > now;
}

/**
 * Keyed by name, URL and the OAuth endpoints and client, so re-pointing a
 * server name at another URL, or a workspace file naming its own token
 * endpoint for the same URL, never hands a stored refresh token to a
 * different authority.
 */
export function tokenSecretKey(server: McpHttpServerConfig): string {
  const oauth = server.oauth;
  const identity = JSON.stringify([
    server.url,
    oauth?.clientId,
    oauth?.authorizationEndpoint,
    oauth?.tokenEndpoint,
    oauth?.resource,
  ]);
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${MCP_OAUTH_SECRET_PREFIX}${server.name}.${digest}`;
}
