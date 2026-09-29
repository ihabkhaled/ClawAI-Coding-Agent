import type { PLUGIN_MARKDOWN_CONTRIBUTIONS, PLUGIN_SCOPES } from './plugin-manifest.constants';
import type {
  mcpServerDeclarationSchema,
  pluginManifestSchema,
  pluginStateSchema,
  pluginSwitchesSchema,
} from './plugin-manifest.schema';
import type { z } from 'zod';

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type McpServerDeclaration = z.infer<typeof mcpServerDeclarationSchema>;
export type PluginSwitches = z.infer<typeof pluginSwitchesSchema>;
export type PluginState = z.infer<typeof pluginStateSchema>;

/** Where a plugin was installed: this profile, or the project's `.clawai/plugins`. */
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

/** A contribution that is a folder of Markdown instruction files. */
export type PluginMarkdownContribution = (typeof PLUGIN_MARKDOWN_CONTRIBUTIONS)[number];

/** One plugin found on disk, with its switches applied. */
export interface InstalledPlugin {
  readonly id: string;
  readonly scope: PluginScope;
  /** The plugin's folder, as an absolute file-system path. */
  readonly root: string;
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly hooksEnabled: boolean;
}

/** A folder that looked like a plugin and was not one, kept so the user can be told why. */
export interface InvalidPlugin {
  readonly scope: PluginScope;
  readonly root: string;
  readonly error: string;
}

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly error: string };

/** One file of a plugin, by its path relative to the plugin's folder. */
export interface PluginBundleFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Why a plugin could not be installed, as a code the UI turns into a sentence. */
export type PluginFailureCode =
  | 'digest-mismatch'
  | 'invalid-catalog'
  | 'invalid-manifest'
  | 'invalid-source'
  | 'name-mismatch'
  | 'not-allowed'
  | 'too-large'
  | 'unreachable'
  | 'unsafe-path';
