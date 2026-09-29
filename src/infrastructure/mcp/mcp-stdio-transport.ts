import spawn from 'cross-spawn';

import { inheritedEnvironment } from '../../core/inherited-environment';
import {
  classifyJsonRpc,
  jsonRpcErrorResponse,
  jsonRpcNotification,
  jsonRpcRequest,
  jsonRpcResultResponse,
  parseJsonSafely,
} from '../../core/mcp/json-rpc';
import {
  JSON_RPC_METHOD_NOT_FOUND,
  MCP_MAX_MESSAGE_BYTES,
  MCP_STDERR_TAIL_BYTES,
  MCP_STDIO_EXIT_GRACE_MS,
} from '../../core/mcp/mcp.constants';
import { redactText } from '../../core/redaction';
import { terminateProcess } from '../process-terminator';

import { McpPendingRequests } from './mcp-pending-requests';

import type { McpStdioLaunch } from './mcp-transport.types';
import type { McpTransport } from '../../core/mcp/mcp.types';
import type { ChildProcess } from 'node:child_process';

/**
 * MCP over a child process's stdin and stdout, one JSON-RPC message per line.
 *
 * The process is launched without a shell and with the bounded inherited
 * environment every other launched command gets, plus the variables the server
 * declares. stderr is kept only as a short redacted tail for diagnostics.
 */
export class McpStdioTransport implements McpTransport {
  private readonly pending = new McpPendingRequests();
  private buffer = '';
  private stderrTail = '';
  private closed = false;

  private constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.receive(chunk);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-MCP_STDERR_TAIL_BYTES);
    });
    child.once('error', (error) => {
      this.fail(`MCP server could not start: ${error.message}`);
    });
    child.once('exit', (code) => {
      this.fail(`MCP server exited${code === null ? '' : ` with code ${String(code)}`}`);
    });
  }

  static start(launch: McpStdioLaunch): McpStdioTransport {
    const child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: inheritedEnvironment(process.env, launch.env),
      shell: false,
      windowsHide: true,
    });
    return new McpStdioTransport(child);
  }

  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(this.closedMessage()));
    const id = this.pending.allocate();
    const waiting = this.pending.wait(id, method, timeoutMs, signal);
    this.write(jsonRpcRequest(id, method, params));
    return waiting;
  }

  notify(method: string, params: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error(this.closedMessage()));
    this.write(jsonRpcNotification(method, params));
    return Promise.resolve();
  }

  /** The redacted tail of the server's stderr, for an error report. */
  diagnostics(): string {
    return redactText(this.stderrTail);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending.failAll(new Error('MCP server connection was closed'));
    this.child.stdin?.end();
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        terminateProcess(this.child);
      }
    }, MCP_STDIO_EXIT_GRACE_MS);
    timer.unref();
  }

  private write(line: string): void {
    this.child.stdin?.write(`${line}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MCP_MAX_MESSAGE_BYTES) {
      this.fail('MCP server sent a message larger than the bound');
      this.dispose();
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.dispatch(parseJsonSafely(line));
      newline = this.buffer.indexOf('\n');
    }
  }

  private dispatch(message: unknown): void {
    const incoming = classifyJsonRpc(message);
    if (incoming.kind === 'response') {
      this.pending.resolve(incoming.id, incoming.result, incoming.error);
      return;
    }
    if (incoming.kind !== 'request') return;
    // A server may ping; anything else it asks of the client (sampling,
    // elicitation, roots) is a capability this client did not advertise.
    this.write(
      incoming.method === 'ping'
        ? jsonRpcResultResponse(incoming.id, {})
        : jsonRpcErrorResponse(incoming.id, JSON_RPC_METHOD_NOT_FOUND, 'Method not found'),
    );
  }

  private fail(message: string): void {
    const tail = this.diagnostics();
    this.pending.failAll(new Error(tail.length > 0 ? `${message}: ${tail}` : message));
    this.closed = true;
  }

  private closedMessage(): string {
    return 'MCP server connection is closed';
  }
}
