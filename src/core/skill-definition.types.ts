/** A `.clawai/skills/*.md` file, once its header has been read. */
export interface SkillDefinition {
  name: string;
  description: string;
  /** What the arguments are for, shown beside the command. */
  argumentHint?: string;
  /** The prompt text, with `$ARGUMENTS` and `$1`…`$9` still in place. */
  body: string;
}
