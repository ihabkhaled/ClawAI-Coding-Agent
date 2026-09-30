import { isAdmissibleMcpUrl, mcpServerNameSchema } from './mcp/mcp-config';
import { PLUGIN_ROOT_TOKEN } from './plugin-manifest.constants';

import type { McpConfigLoad, McpServerConfig } from './mcp/mcp.types';
import type { InstalledPlugin, McpServerDeclaration } from './plugin-manifest.types';

function substituteRoot(value: string, root: string): string {
  return value.split(PLUGIN_ROOT_TOKEN).join(root);
}

function toServer(
  name: string,
  declaration: McpServerDeclaration,
  root: string,
): McpServerConfig | string {
  if (declaration.command !== undefined) {
    return {
      name,
      origin: 'plugin',
      transport: 'stdio',
      command: substituteRoot(declaration.command, root),
      args: declaration.args.map((argument) => substituteRoot(argument, root)),
      env: {},
    };
  }
  const url = declaration.url ?? '';
  if (!isAdmissibleMcpUrl(url))
    return `plugin MCP server "${name}" must be https, or http on localhost`;
  return { name, origin: 'plugin', transport: 'http', url, headers: {} };
}

/**
 * The MCP servers enabled plugins declare, as MCP configuration.
 *
 * Each is named `publisher.plugin.server`, so a plugin can neither take a name
 * the user or the project already uses nor another plugin's. They are only
 * candidates: the registry still puts every one through the organization and
 * project `mcpServers` policy, and a local one still needs a trusted
 * workspace. A disabled plugin contributes nothing, so turning it off stops
 * its servers at the next call.
 */
export function pluginMcpServers(plugins: readonly InstalledPlugin[]): McpConfigLoad {
  const servers: McpServerConfig[] = [];
  const errors: string[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const [server, declaration] of Object.entries(plugin.manifest.contributes.mcpServers)) {
      const name = `${plugin.id}.${server}`;
      if (!mcpServerNameSchema.safeParse(name).success) {
        errors.push(`plugin MCP server "${name}" has a name that is too long`);
        continue;
      }
      const converted = toServer(name, declaration, plugin.root);
      if (typeof converted === 'string') errors.push(converted);
      else servers.push(converted);
    }
  }
  return { servers, errors };
}
