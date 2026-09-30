import { evaluateHookApproval, hooksDigest } from './plugin-hook-approval';
import { PLUGIN_MANIFEST_FILE, PLUGIN_ROOT_TOKEN } from './plugin-manifest.constants';
import { pluginManifestSchema } from './plugin-manifest.schema';

import type { LifecycleHook } from './lifecycle-hook.types';
import type {
  InstalledPlugin,
  ManifestParseResult,
  PluginBundleFile,
  PluginManifest,
  PluginMarkdownContribution,
  PluginScope,
  PluginState,
  PluginSwitches,
} from './plugin-manifest.types';

/**
 * A plugin nobody has touched. A user plugin's instructions are on; a workspace
 * plugin arrived with a repository, so nothing of it runs until it is enabled.
 * Commands are off either way.
 */
function defaultSwitches(scope: PluginScope): PluginSwitches {
  return { enabled: scope === 'user', hooksEnabled: false };
}

/**
 * Reads `clawai-plugin.json`.
 *
 * The error is the first issue's path and message, which is what a person
 * fixing a manifest by hand needs; the full zod report is not.
 */
export function parsePluginManifest(text: string): ManifestParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is not valid JSON` };
  }
  const parsed = pluginManifestSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
  return { ok: false, error: `${where}${issue?.message ?? 'invalid manifest'}` };
}

/** `publisher.name`, the way a marketplace and a person both refer to a plugin. */
export function pluginId(manifest: PluginManifest): string {
  return `${manifest.publisher}.${manifest.name}`;
}

/**
 * A plugin with its switches applied.
 *
 * Nothing stored means the defaults: instructions on, hooks off. A hook runs a
 * command, so it is the one contribution that has to be switched on by a person
 * — installing a plugin, or cloning a repository that ships one, is not enough.
 */
export function describeInstalled(
  manifest: PluginManifest,
  scope: PluginScope,
  root: string,
  state: PluginState,
): InstalledPlugin {
  const stored = state[root];
  const switches = stored ?? defaultSwitches(scope);
  const hookApproval = evaluateHookApproval(stored, manifest);
  return {
    id: pluginId(manifest),
    scope,
    root,
    manifest,
    enabled: switches.enabled,
    hooksEnabled: switches.enabled && hookApproval.status === 'approved',
    hooksDigest: hooksDigest(manifest),
    hookApproval,
    needsApproval: scope === 'workspace' && stored === undefined,
  };
}

/** The folders enabled plugins of one scope contribute for one kind of Markdown. */
export function contributionFolders(
  plugins: readonly InstalledPlugin[],
  kind: PluginMarkdownContribution,
  scope: PluginScope,
): { root: string; folder: string }[] {
  return plugins
    .filter((plugin) => plugin.enabled && plugin.scope === scope)
    .flatMap((plugin) =>
      plugin.manifest.contributes[kind].map((folder) => ({ root: plugin.root, folder })),
    );
}

function substituteRoot(value: string, root: string): string {
  return value.split(PLUGIN_ROOT_TOKEN).join(root);
}

/**
 * The hooks of every plugin whose hooks a person switched on.
 *
 * `${pluginRoot}` becomes the plugin's own folder, so a hook can run a script
 * the plugin ships without knowing where it was installed.
 */
export function enabledPluginHooks(plugins: readonly InstalledPlugin[]): LifecycleHook[] {
  return plugins
    .filter((plugin) => plugin.hooksEnabled)
    .flatMap((plugin) =>
      plugin.manifest.contributes.hooks.map((hook) => ({
        ...hook,
        command: substituteRoot(hook.command, plugin.root),
        arguments: hook.arguments.map((argument) => substituteRoot(argument, plugin.root)),
      })),
    );
}

/** The manifest inside a set of plugin files, read as the installer will read it. */
export function manifestInBundle(files: readonly PluginBundleFile[]): ManifestParseResult {
  const manifest = files.find((file) => file.path === PLUGIN_MANIFEST_FILE);
  if (manifest === undefined) return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is missing` };
  return parsePluginManifest(new TextDecoder('utf-8', { fatal: false }).decode(manifest.bytes));
}
