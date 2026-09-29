import { z } from 'zod';

import { redactText, redactValue } from '../redaction';

import {
  MCP_CLIENT_NAME,
  MCP_MAX_DESCRIPTION_CHARACTERS,
  MCP_MAX_RESULT_TEXT_CHARACTERS,
  MCP_MAX_SCHEMA_CHARACTERS,
  MCP_MAX_TOOLS_PER_SERVER,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TRUNCATION_NOTICE,
} from './mcp.constants';

import type { McpContentSummary, McpToolSummary } from './mcp.types';

export const initializeResultSchema = z
  .object({
    protocolVersion: z.string().min(1).max(40),
    capabilities: z.record(z.string(), z.unknown()).default({}),
    serverInfo: z
      .object({ name: z.string().max(200), version: z.string().max(100).optional() })
      .loose()
      .optional(),
  })
  .loose();

const toolSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(100_000).optional(),
    inputSchema: z.unknown().optional(),
  })
  .loose();

export const toolsListResultSchema = z
  .object({
    tools: z.array(toolSchema).max(MCP_MAX_TOOLS_PER_SERVER),
    nextCursor: z.string().max(4_096).optional(),
  })
  .loose();

const contentPartSchema = z
  .object({
    type: z.string().max(50),
    text: z.string().optional(),
    mimeType: z.string().max(200).optional(),
    resource: z
      .object({ uri: z.string().max(4_096), text: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

export const callToolResultSchema = z
  .object({
    content: z.array(contentPartSchema).max(1_000).default([]),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .loose();

export type McpToolsListResult = z.infer<typeof toolsListResultSchema>;

export function initializeParams(version: string): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: MCP_CLIENT_NAME, version },
  };
}

/** Throws when the server settled on a revision this client does not speak. */
export function assertSupportedProtocol(candidate: unknown): void {
  const result = initializeResultSchema.parse(candidate);
  if (!(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(result.protocolVersion)) {
    throw new Error(`MCP server negotiated unsupported protocol ${result.protocolVersion}`);
  }
}

export function boundText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  const keep = Math.max(0, limit - MCP_TRUNCATION_NOTICE.length);
  return { text: `${value.slice(0, keep)}${MCP_TRUNCATION_NOTICE}`, truncated: true };
}

function stringify(value: unknown): string {
  try {
    return value === undefined ? '' : JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Tool listings are written by the server, not by the user, so they are
 * redacted and bounded like any other untrusted text before the model sees them.
 */
export function summarizeTools(result: McpToolsListResult['tools']): McpToolSummary[] {
  return result.map((tool) => ({
    name: tool.name,
    description: boundText(redactText(tool.description ?? ''), MCP_MAX_DESCRIPTION_CHARACTERS).text,
    inputSchema: boundText(stringify(tool.inputSchema ?? {}), MCP_MAX_SCHEMA_CHARACTERS).text,
  }));
}

type ContentPart = z.infer<typeof contentPartSchema>;

function partText(part: ContentPart): string | undefined {
  if (part.type === 'text') return part.text ?? '';
  if (part.type === 'resource' && part.resource?.text !== undefined) {
    return `[resource ${part.resource.uri}]\n${part.resource.text}`;
  }
  return undefined;
}

/**
 * Binary parts (images, audio, blobs) are named and dropped rather than passed
 * through: base64 in a text channel spends the model's context on noise.
 */
export function summarizeCallResult(candidate: unknown): McpContentSummary {
  const result = callToolResultSchema.parse(candidate);
  const texts: string[] = [];
  const omittedParts: string[] = [];
  for (const part of result.content) {
    const text = partText(part);
    if (text === undefined)
      omittedParts.push(`${part.type}${part.mimeType === undefined ? '' : ` (${part.mimeType})`}`);
    else texts.push(text);
  }
  if (result.structuredContent !== undefined) {
    texts.push(`[structuredContent]\n${stringify(redactValue(result.structuredContent))}`);
  }
  const bounded = boundText(redactText(texts.join('\n')), MCP_MAX_RESULT_TEXT_CHARACTERS);
  return {
    text: bounded.text,
    truncated: bounded.truncated,
    isError: result.isError === true,
    omittedParts: omittedParts.slice(0, 50),
  };
}
