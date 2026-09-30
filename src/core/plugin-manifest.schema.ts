import { z } from 'zod';

import { lifecycleHookSchema } from './lifecycle-hook';
import { isContainedRelativePath } from './plugin-path';

/** Lower-case, dash-separated, as a folder name and an id segment both allow. */
const pluginNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u);

const containedPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(isContainedRelativePath, 'must be a relative path inside the plugin');

const pathListSchema = z.array(containedPathSchema).max(20).default([]);

/**
 * An MCP server the plugin declares. Recorded, not started: starting an MCP
 * server belongs to the MCP client, and a plugin reaching past it would be a
 * second, unaudited way to run a process.
 */
export const mcpServerDeclarationSchema = z
  .object({
    command: z.string().min(1).max(4_096).optional(),
    args: z.array(z.string().max(4_096)).max(64).default([]),
    url: z.url().max(2_048).optional(),
  })
  .strict()
  .refine(
    (server) => (server.command === undefined) !== (server.url === undefined),
    'An MCP server declares exactly one of command or url',
  );

export const pluginContributionsSchema = z
  .object({
    skills: pathListSchema,
    commands: pathListSchema,
    outputStyles: pathListSchema,
    agents: pathListSchema,
    hooks: z.array(lifecycleHookSchema).max(20).default([]),
    mcpServers: z
      .record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u), mcpServerDeclarationSchema)
      .refine((servers) => Object.keys(servers).length <= 20, 'At most 20 MCP servers')
      .default({}),
  })
  .strict();

/** `clawai-plugin.json`, parsed rather than trusted: a plugin is someone else's content. */
export const pluginManifestSchema = z
  .object({
    name: pluginNameSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
    description: z.string().max(1_000).default(''),
    publisher: pluginNameSchema,
    contributes: pluginContributionsSchema.prefault({}),
  })
  .strict();

export const pluginSwitchesSchema = z
  .object({
    enabled: z.boolean(),
    hooksEnabled: z.boolean(),
    /** Digest of the hooks and version a person approved; absent on approvals made before it existed. */
    hooksDigest: z.string().max(128).optional(),
    /** The command lines shown at approval, so a change can name what is new. */
    approvedCommands: z.array(z.string().max(8_192)).max(20).optional(),
  })
  .strict();

/** Switches keyed by the plugin's installed folder, so two workspaces never share one. */
export const pluginStateSchema = z.record(z.string().min(1).max(4_096), pluginSwitchesSchema);
