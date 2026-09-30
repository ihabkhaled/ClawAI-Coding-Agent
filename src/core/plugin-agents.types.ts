/** One Markdown file from a plugin's `agents` folder, with the plugin it came from. */
export interface PluginAgentFile {
  readonly pluginId: string;
  readonly fileName: string;
  readonly content: string;
}
