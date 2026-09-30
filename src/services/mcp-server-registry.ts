import { mergeMcpConfigs, parseMcpConfig } from '../core/mcp/mcp-config';
import { admitMcpServers, readMcpServerPolicy } from '../core/mcp/mcp-server-policy';
import { redactText } from '../core/redaction';

import type { McpRegistryDependencies, McpServerReport } from './mcp-server-registry.types';
import type {
  McpAdmission,
  McpConfigLoad,
  McpContentSummary,
  McpServerConfig,
  McpSession,
  McpToolSummary,
} from '../core/mcp/mcp.types';

interface CachedConnection {
  readonly fingerprint: string;
  readonly client: Promise<McpSession>;
}

/**
 * The configured MCP servers, the policy verdict on each, and the live
 * connections to the admitted ones.
 *
 * Configuration and policy are re-read on every call rather than cached: a
 * server the organization denies a minute from now must stop being reachable
 * a minute from now, not at the next window reload. A refused server is never
 * started; one that becomes refused has its connection closed.
 */
export class McpServerRegistry {
  private readonly connections = new Map<string, CachedConnection>();

  constructor(private readonly deps: McpRegistryDependencies) {}

  async servers(): Promise<McpServerReport> {
    const { config, admission } = await this.evaluate();
    return {
      servers: admission.admitted.map((server) => ({
        name: server.name,
        origin: server.origin,
        transport: server.transport,
        target: server.transport === 'stdio' ? server.command : server.url,
        connected: this.connections.has(server.name),
        oauth: server.transport === 'http' && server.oauth !== undefined,
      })),
      refused: admission.refused,
      errors: config.errors.map(redactText),
    };
  }

  async tools(name: string, signal?: AbortSignal): Promise<McpToolSummary[]> {
    const client = await this.client(name, signal);
    return client.listTools(signal);
  }

  async call(
    name: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpContentSummary> {
    const client = await this.client(name, signal);
    return client.callTool(tool, args, timeoutMs, signal);
  }

  dispose(): void {
    for (const name of [...this.connections.keys()]) this.close(name);
  }

  private async evaluate(): Promise<{ config: McpConfigLoad; admission: McpAdmission }> {
    const configured = mergeMcpConfigs(
      parseMcpConfig(this.deps.userConfig(), 'user'),
      await this.workspaceConfig(),
    );
    // Plugin servers come last, so they never take a name already in use.
    const config =
      this.deps.pluginConfig === undefined
        ? configured
        : mergeMcpConfigs(configured, await this.deps.pluginConfig());
    const organization = readMcpServerPolicy(this.deps.organizationPolicy());
    const project = readMcpServerPolicy(await this.deps.projectPolicy());
    const admission = admitMcpServers(
      config.servers,
      {
        ...(organization === undefined ? {} : { organization }),
        ...(project === undefined ? {} : { project }),
      },
      this.deps.workspaceTrusted(),
    );
    // A server that is refused, or no longer configured at all — a plugin that
    // was disabled or uninstalled — has its connection closed.
    const admitted = new Set(admission.admitted.map((server) => server.name));
    for (const name of [...this.connections.keys()]) if (!admitted.has(name)) this.close(name);
    return { config, admission };
  }

  private async workspaceConfig(): Promise<McpConfigLoad> {
    try {
      return parseMcpConfig(await this.deps.workspaceConfig(), 'workspace');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { servers: [], errors: [`workspace MCP configuration could not be read: ${message}`] };
    }
  }

  private async client(name: string, signal?: AbortSignal): Promise<McpSession> {
    const server = await this.admitted(name);
    const fingerprint = JSON.stringify(server);
    const cached = this.connections.get(name);
    if (cached?.fingerprint === fingerprint) return cached.client;
    if (cached !== undefined) this.close(name);
    const client = this.deps.connect(server, signal);
    this.connections.set(name, { fingerprint, client });
    // A failed connection is forgotten so the next call tries again.
    client.catch(() => {
      if (this.connections.get(name)?.client === client) this.connections.delete(name);
    });
    return client;
  }

  private async admitted(name: string): Promise<McpServerConfig> {
    const { admission } = await this.evaluate();
    const refused = admission.refused.find((refusal) => refusal.name === name);
    if (refused !== undefined) {
      throw new Error(`MCP server "${name}" is refused (${refused.code}): ${refused.reason}`);
    }
    const server = admission.admitted.find((candidate) => candidate.name === name);
    if (server === undefined) throw new Error(`No MCP server named "${name}" is configured`);
    return server;
  }

  private close(name: string): void {
    const cached = this.connections.get(name);
    if (cached === undefined) return;
    this.connections.delete(name);
    void cached.client.then(
      (client) => {
        client.dispose();
      },
      () => undefined,
    );
  }
}
