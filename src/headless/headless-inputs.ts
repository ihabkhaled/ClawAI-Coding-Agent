import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseMcpConfig } from '../core/mcp/mcp-config';
import { MAX_MCP_CONFIG_BYTES } from '../core/mcp/mcp.constants';
import { systemPromptProblem } from '../sdk/agent-inputs';

import {
  HEADLESS_MAX_PROMPT_FILE_BYTES,
  HEADLESS_MCP_POLICY_KEY,
} from './headless-inputs.constants';

import type { HeadlessInvocation } from './headless-args.types';
import type { HeadlessInputs } from './headless-inputs.types';
import type { AgentMcpOptions } from '../sdk/mcp-toolkit.types';

async function readBounded(file: string, limit: number): Promise<string> {
  if ((await stat(file)).size > limit)
    throw new Error(`${path.basename(file)} is larger than ${String(limit)} bytes.`);
  return readFile(file, 'utf8');
}

/** Text as given, or the contents of the file when it starts with `@`. */
async function promptText(value: string, cwd: string): Promise<string> {
  if (!value.startsWith('@')) return value;
  return readBounded(path.resolve(cwd, value.slice(1)), HEADLESS_MAX_PROMPT_FILE_BYTES);
}

async function systemPromptOf(
  invocation: HeadlessInvocation,
  cwd: string,
): Promise<string | undefined> {
  const parts: string[] = [];
  if (invocation.systemPromptFile !== undefined) {
    parts.push(await readBounded(invocation.systemPromptFile, HEADLESS_MAX_PROMPT_FILE_BYTES));
  }
  if (invocation.appendSystemPrompt !== undefined) {
    parts.push(await promptText(invocation.appendSystemPrompt, cwd));
  }
  if (parts.length === 0) return undefined;
  const text = parts.map((part) => part.trim()).join('\n\n');
  const problem = systemPromptProblem(text);
  if (problem !== undefined) throw new Error(problem);
  return text;
}

/** JSON.parse without its habit of quoting the file, which may hold a secret. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The MCP config is not valid JSON.');
  }
}

export async function mcpOf(file: string): Promise<AgentMcpOptions> {
  const parsed = parseJson(await readBounded(file, MAX_MCP_CONFIG_BYTES));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The MCP config must be a JSON object.');
  }
  const { [HEADLESS_MCP_POLICY_KEY]: policy, ...config } = parsed as Record<string, unknown>;
  const load = parseMcpConfig(config, 'user');
  const first = load.errors[0];
  if (first !== undefined) throw new Error(first);
  if (load.servers.length === 0) throw new Error('The MCP config declares no servers.');
  return { config, ...(policy === undefined ? {} : { policy }) };
}

/**
 * Reads what the flags point at. A missing or unusable file is reported before
 * any request is made, so it is a usage error and not a failed run.
 */
export async function resolveHeadlessInputs(
  invocation: HeadlessInvocation,
  cwd: string,
): Promise<HeadlessInputs> {
  try {
    const systemPrompt = await systemPromptOf(invocation, cwd);
    const mcp = invocation.mcpConfig === undefined ? undefined : await mcpOf(invocation.mcpConfig);
    return {
      ok: true,
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
      ...(mcp === undefined ? {} : { mcp }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unreadable input file.',
    };
  }
}
