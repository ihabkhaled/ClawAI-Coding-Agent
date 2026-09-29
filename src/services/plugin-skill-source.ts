import { contributionFolders } from '../core/plugin-manifest';

import type { PluginStore } from './plugin-store';
import type { SkillFile, SkillSourcePort } from './skill-catalog.types';
import type { PluginMarkdownContribution, PluginScope } from '../core/plugin-manifest.types';

/**
 * A skill source with enabled plugins' Markdown folded in.
 *
 * Plugin files come first in each scope, so the user's and the project's own
 * files of the same name are read after them and win in the catalog. A plugin
 * adds commands; it does not get to quietly replace one somebody wrote.
 *
 * A plugin that cannot be read contributes nothing rather than failing the
 * catalog, for the same reason a half-written skill file is skipped.
 */
export class PluginSkillSource implements SkillSourcePort {
  constructor(
    private readonly base: SkillSourcePort,
    private readonly store: PluginStore,
    private readonly kinds: readonly PluginMarkdownContribution[],
  ) {}

  async global(): Promise<readonly SkillFile[]> {
    return [...(await this.pluginFiles('user')), ...(await this.base.global())];
  }

  async project(): Promise<readonly SkillFile[]> {
    return [...(await this.pluginFiles('workspace')), ...(await this.base.project())];
  }

  private async pluginFiles(scope: PluginScope): Promise<SkillFile[]> {
    try {
      const { plugins } = await this.store.list();
      const files: SkillFile[] = [];
      for (const kind of this.kinds) {
        for (const { root, folder } of contributionFolders(plugins, kind, scope)) {
          files.push(...(await this.store.markdownFiles(root, folder)));
        }
      }
      return files;
    } catch {
      return [];
    }
  }
}
