import { parseHostRules } from '../sdk/http-host-rules';
import { createHttpTool } from '../sdk/http-tool';
import { requestedMethod } from '../sdk/http-tool-request';
import { HTTP_READ_METHODS } from '../sdk/http-tool.constants';

import {
  HTTP_REQUEST_INPUT_SCHEMA,
  HTTP_REQUEST_READ_OPERATION,
  HTTP_REQUEST_TOOL_DESCRIPTION,
  HTTP_REQUEST_TOOL_NAME,
  HTTP_REQUEST_WRITE_OPERATION,
  HTTP_SETTING,
} from './opt-in-tools.constants';

import type { OptInToolSettings } from './opt-in-tools.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { HttpTool } from '../sdk/http-tool.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const httpRequestToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: HTTP_REQUEST_TOOL_NAME,
  version: '1.0.0',
  description: HTTP_REQUEST_TOOL_DESCRIPTION,
  operations: [HTTP_REQUEST_READ_OPERATION, HTTP_REQUEST_WRITE_OPERATION],
  riskClasses: ['network'],
  targetIds: ['target:workspace'],
  inputSchema: HTTP_REQUEST_INPUT_SCHEMA,
};

/**
 * `http.request` in the editor: the same host-free tool the command line uses,
 * with the same host allowlist, address checks and secret handling, behind two
 * operations so the permission policy can tell a read from a write.
 *
 * The method decides which operation is legal, never the other way round: a
 * `get` that carries POST would otherwise slip a write past the read-level
 * approval. The hosts are read on every call, so removing one from the setting
 * takes effect at once. The tool is kept between calls only so its saved values
 * (a login token the model can spend but not read) live as long as the hosts
 * do not change.
 */
export class HttpRequestToolExecutor implements RuntimeToolExecutorPort {
  private cached: { readonly key: string; readonly tool: HttpTool } | undefined;

  constructor(private readonly settings: OptInToolSettings) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== HTTP_REQUEST_TOOL_NAME) throw new Error('Unknown HTTP tool');
    const method = requestedMethod(invocation.arguments);
    this.requireMatchingOperation(invocation.operation, method);
    const result = await this.tool().execute(invocation.arguments, signal);
    return { structured: typeof result === 'object' && result !== null ? { ...result } : {} };
  }

  private requireMatchingOperation(operation: string, method: string | undefined): void {
    const read = method !== undefined && HTTP_READ_METHODS.includes(method);
    if (operation === HTTP_REQUEST_READ_OPERATION && !read) {
      throw new Error(
        `Operation "get" sends GET or HEAD only. Use operation "send" for ${method ?? 'a write method'}.`,
      );
    }
    if (operation === HTTP_REQUEST_WRITE_OPERATION && (method === undefined || read)) {
      throw new Error(
        'Operation "send" is for POST, PUT, PATCH or DELETE. Use operation "get" for GET and HEAD.',
      );
    }
    if (operation !== HTTP_REQUEST_READ_OPERATION && operation !== HTTP_REQUEST_WRITE_OPERATION) {
      throw new Error('Unknown HTTP operation');
    }
  }

  private tool(): HttpTool {
    const hosts = this.settings.httpAllowHosts();
    if (hosts.length === 0) {
      throw new Error(
        `http.request is off: no host is allowed. The user turns it on with the ${HTTP_SETTING} setting.`,
      );
    }
    const key = hosts.join('\n');
    if (this.cached?.key === key) return this.cached.tool;
    const rules = parseHostRules(hosts);
    if (typeof rules === 'string') throw new Error(rules);
    const tool = createHttpTool({ rules });
    this.cached = { key, tool };
    return tool;
  }
}
