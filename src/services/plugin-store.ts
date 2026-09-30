import { PluginFailure } from '../core/plugin-failure';
import { hookCommandLines } from '../core/plugin-hook-approval';
import { describeInstalled, manifestInBundle, parsePluginManifest } from '../core/plugin-manifest';
import {
  MAX_MANIFEST_BYTES,
  MAX_PLUGIN_BYTES,
  MAX_PLUGIN_DEPTH,
  MAX_PLUGIN_FILES,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_STATE_FILE,
} from '../core/plugin-manifest.constants';
import { pluginStateSchema } from '../core/plugin-manifest.schema';
import { isContainedRelativePath } from '../core/plugin-path';
import { PLUGIN_PROVENANCE_FILE } from '../core/plugin-signature.constants';
import { pluginProvenanceSchema } from '../core/plugin-signature.schema';

import type { PluginFileSystemPort, PluginProvenance, PluginRoots } from './plugin-store.types';
import type { SkillFile } from './skill-catalog.types';
import type {
  InstalledPlugin,
  InvalidPlugin,
  ManifestParseResult,
  PluginBundleFile,
  PluginScope,
  PluginState,
  PluginSwitches,
} from '../core/plugin-manifest.types';

/** Markdown files larger than this are not an instruction, and are skipped. */
const MAX_MARKDOWN_BYTES = 128 * 1024;

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Plugins on disk: what is installed, which are switched on, and the files.
 *
 * Switches live in the profile's own storage, never beside a workspace plugin.
 * A repository can ship a plugin; it cannot ship the decision to run its hooks.
 */
export class PluginStore {
  constructor(
    private readonly files: PluginFileSystemPort,
    private readonly roots: PluginRoots,
  ) {}

  rootFor(scope: PluginScope): string | undefined {
    return scope === 'user' ? this.roots.user() : this.roots.workspace();
  }

  async list(): Promise<{ plugins: InstalledPlugin[]; invalid: InvalidPlugin[] }> {
    const state = await this.readState();
    const provenance = await this.readProvenance();
    const plugins: InstalledPlugin[] = [];
    const invalid: InvalidPlugin[] = [];
    for (const scope of ['user', 'workspace'] as const) {
      const base = this.rootFor(scope);
      if (base === undefined) continue;
      for (const entry of await this.files.list(base)) {
        if (entry.kind !== 'directory') continue;
        const root = this.files.join(base, entry.name);
        const parsed = await this.readManifest(root);
        if (parsed.ok) {
          const installed = describeInstalled(parsed.manifest, scope, root, state);
          const signature = provenance[root];
          plugins.push(signature === undefined ? installed : { ...installed, signature });
        } else invalid.push({ scope, root, error: parsed.error });
      }
    }
    return { plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)), invalid };
  }

  async setSwitches(plugin: InstalledPlugin, switches: PluginSwitches): Promise<void> {
    const state = await this.readState();
    const approved = switches.hooksEnabled
      ? { hooksDigest: plugin.hooksDigest, approvedCommands: hookCommandLines(plugin.manifest) }
      : {};
    await this.writeState({
      ...state,
      [plugin.root]: {
        enabled: switches.enabled,
        hooksEnabled: switches.hooksEnabled,
        ...approved,
      },
    });
  }

  /**
   * Writes a verified set of files as a plugin, replacing any earlier version.
   *
   * The folder is named `publisher.name` from the manifest inside the files,
   * never from where they came from, so an update lands on top of the old one.
   */
  async install(scope: PluginScope, bundle: readonly PluginBundleFile[]): Promise<string> {
    const base = this.rootFor(scope);
    if (base === undefined) throw new PluginFailure('invalid-source', 'no workspace folder');
    const parsed = manifestInBundle(bundle);
    if (!parsed.ok) throw new PluginFailure('invalid-manifest', parsed.error);
    for (const file of bundle) {
      if (!isContainedRelativePath(file.path)) throw new PluginFailure('unsafe-path', file.path);
    }
    const root = this.files.join(base, `${parsed.manifest.publisher}.${parsed.manifest.name}`);
    await this.files.delete(root);
    for (const file of bundle) {
      await this.files.writeFile(this.files.join(root, ...file.path.split('/')), file.bytes);
    }
    // Hook approval is bound to a digest of the commands and version, so an
    // update that changes either revokes it without this method deciding.
    return root;
  }

  /** Remembers who signed what was just installed at `root`; no signer records it as unsigned. */
  async recordSignature(root: string, signedBy: string | undefined): Promise<void> {
    const provenance = await this.readProvenance();
    const entry = signedBy === undefined ? {} : { signedBy };
    await this.writeProvenance({ ...provenance, [root]: entry });
  }

  async uninstall(plugin: InstalledPlugin): Promise<void> {
    await this.files.delete(plugin.root);
    const provenance = await this.readProvenance();
    await this.writeProvenance(
      Object.fromEntries(Object.entries(provenance).filter(([root]) => root !== plugin.root)),
    );
    const state = await this.readState();
    const remaining = Object.fromEntries(
      Object.entries(state).filter(([root]) => root !== plugin.root),
    );
    await this.writeState(remaining);
  }

  /** Every file under a folder, bounded in count, size and depth. */
  async readTree(root: string): Promise<PluginBundleFile[]> {
    const collected: PluginBundleFile[] = [];
    await this.walk(root, '', 0, collected, { bytes: 0 });
    return collected;
  }

  /** The Markdown files directly inside one contributed folder. */
  async markdownFiles(root: string, folder: string): Promise<SkillFile[]> {
    const directory = this.files.join(root, ...folder.split('/'));
    const found: SkillFile[] = [];
    for (const entry of await this.files.list(directory)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      const bytes = await this.files.readFile(this.files.join(directory, entry.name));
      if (bytes === undefined || bytes.byteLength > MAX_MARKDOWN_BYTES) continue;
      found.push({ fileName: entry.name, content: decoder.decode(bytes) });
    }
    return found;
  }

  private async walk(
    directory: string,
    prefix: string,
    depth: number,
    collected: PluginBundleFile[],
    total: { bytes: number },
  ): Promise<void> {
    if (depth > MAX_PLUGIN_DEPTH) throw new PluginFailure('too-large', 'folder is too deep');
    for (const entry of await this.files.list(directory)) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = this.files.join(directory, entry.name);
      if (entry.kind === 'directory') {
        await this.walk(absolute, path, depth + 1, collected, total);
        continue;
      }
      const bytes = (await this.files.readFile(absolute)) ?? new Uint8Array();
      total.bytes += bytes.byteLength;
      if (collected.length >= MAX_PLUGIN_FILES || total.bytes > MAX_PLUGIN_BYTES) {
        throw new PluginFailure('too-large');
      }
      collected.push({ path, bytes });
    }
  }

  private async readManifest(root: string): Promise<ManifestParseResult> {
    const bytes = await this.files.readFile(this.files.join(root, PLUGIN_MANIFEST_FILE));
    if (bytes === undefined) return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is missing` };
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is too large` };
    }
    return parsePluginManifest(decoder.decode(bytes));
  }

  private statePath(): string {
    return this.files.join(this.roots.user(), PLUGIN_STATE_FILE);
  }

  private async readState(): Promise<PluginState> {
    const bytes = await this.files.readFile(this.statePath());
    if (bytes === undefined) return {};
    try {
      return pluginStateSchema.safeParse(JSON.parse(decoder.decode(bytes))).data ?? {};
    } catch {
      // A damaged switch file resets to defaults, and defaults keep hooks off.
      return {};
    }
  }

  private async readProvenance(): Promise<PluginProvenance> {
    const bytes = await this.files.readFile(
      this.files.join(this.roots.user(), PLUGIN_PROVENANCE_FILE),
    );
    if (bytes === undefined) return {};
    try {
      return pluginProvenanceSchema.safeParse(JSON.parse(decoder.decode(bytes))).data ?? {};
    } catch {
      return {};
    }
  }

  private async writeProvenance(provenance: PluginProvenance): Promise<void> {
    const text = `${JSON.stringify(provenance, null, 2)}
`;
    await this.files.writeFile(
      this.files.join(this.roots.user(), PLUGIN_PROVENANCE_FILE),
      new TextEncoder().encode(text),
    );
  }

  private async writeState(state: PluginState): Promise<void> {
    const text = `${JSON.stringify(state, null, 2)}\n`;
    await this.files.writeFile(this.statePath(), new TextEncoder().encode(text));
  }
}
