import type { InstalledPlugin, InvalidPlugin } from '../core/plugin-manifest.types';

/** One row of the Plugins view: an installed plugin, or a folder that is not one. */
export type PluginTreeNode =
  | { readonly kind: 'plugin'; readonly plugin: InstalledPlugin }
  | { readonly kind: 'invalid'; readonly problem: InvalidPlugin };

/** What the view lists, read from the plugin store each time it refreshes. */
export type PluginListing = () => Promise<{
  readonly plugins: readonly InstalledPlugin[];
  readonly invalid: readonly InvalidPlugin[];
}>;
