import { parseSkillFile } from '../core/skill-definition';

import type { SkillSourcePort } from './skill-catalog.types';
import type { SkillDefinition } from '../core/skill-definition.types';

/**
 * The skills a workspace offers as commands.
 *
 * Project skills win over global ones of the same name. A repository that
 * ships a `review` skill means its own review, and a profile-wide default that
 * quietly overrode it would be the opposite of what either author intended.
 *
 * A file that does not parse is skipped rather than reported: these are
 * workspace content, a half-written one is normal, and failing the catalog
 * over it would take every other skill down with it.
 */
export class SkillCatalogService {
  /**
   * `builtins` are the commands the extension ships, such as
   * `/security-review`. They are listed first so a workspace or global skill of
   * the same name replaces them: a team's own security checklist should win
   * over a generic one.
   */
  constructor(
    private readonly sources: SkillSourcePort,
    private readonly builtins: readonly SkillDefinition[] = [],
  ) {}

  async list(): Promise<SkillDefinition[]> {
    const byName = new Map<string, SkillDefinition>(
      this.builtins.map((skill) => [skill.name, skill]),
    );
    for (const file of [...(await this.sources.global()), ...(await this.sources.project())]) {
      const skill = parseSkillFile(file.fileName, file.content);
      if (skill !== undefined) byName.set(skill.name, skill);
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async find(name: string): Promise<SkillDefinition | undefined> {
    return (await this.list()).find((skill) => skill.name === name);
  }
}
