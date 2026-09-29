/** The file that makes a folder a ClawAI plugin. */
export const PLUGIN_MANIFEST_FILE = 'clawai-plugin.json';

/** The file a local marketplace folder lists its plugins in. */
export const MARKETPLACE_CATALOG_FILE = 'clawai-marketplace.json';

/** Where plugins live, under global storage and under `.clawai` in a project. */
export const PLUGIN_DIRECTORY = 'plugins';

/** Which plugins are switched on. Kept in the profile, never in the repository. */
export const PLUGIN_STATE_FILE = 'plugin-state.json';

/** Replaced in a hook's command and arguments with the plugin's own folder. */
export const PLUGIN_ROOT_TOKEN = '${pluginRoot}';

/** The two places a plugin can be installed. */
export const PLUGIN_SCOPES = ['user', 'workspace'] as const;

/** The contributions that are folders of Markdown the skill reader already understands. */
export const PLUGIN_MARKDOWN_CONTRIBUTIONS = ['skills', 'commands', 'outputStyles'] as const;

/** A plugin with more files than this is not a plugin; it is a repository. */
export const MAX_PLUGIN_FILES = 500;

/** The most bytes one plugin, or one downloaded archive, may hold. */
export const MAX_PLUGIN_BYTES = 10 * 1024 * 1024;

/** A manifest larger than this is refused before it is parsed. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/** How deep a plugin folder is walked when it is copied or hashed. */
export const MAX_PLUGIN_DEPTH = 8;
