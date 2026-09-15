import { parseSkillFile } from '../core/skill-definition';

import type { SkillSourcePort } from './skill-catalog.types';
import type { OutputStyleDefinition } from '../core/output-style.types';

/**
 * Response styles a workspace or profile defines, as `.md` files.
 *
 * Parsed by the same reader skills use, which is the point: a style and a
 * skill are the same kind of thing — a named, described block of instruction
 * in a file — and two readers for one format would drift apart.
 *
 * Project styles win over profile-wide ones of the same name, for the reason
 * project skills do: a repository that defines `concise` means its own.
 */
export class OutputStyleCatalog {
  constructor(private readonly sources: SkillSourcePort) {}

  async list(): Promise<OutputStyleDefinition[]> {
    const byName = new Map<string, OutputStyleDefinition>();
    for (const file of [...(await this.sources.global()), ...(await this.sources.project())]) {
      const parsed = parseSkillFile(file.fileName, file.content);
      if (parsed !== undefined)
        byName.set(parsed.name, { name: parsed.name, preamble: parsed.body });
    }
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}
