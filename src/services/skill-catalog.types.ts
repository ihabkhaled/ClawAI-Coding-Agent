/** One skill file as it was found on disk. */
export interface SkillFile {
  fileName: string;
  content: string;
}

/** Where skill files come from, profile-wide first and project second. */
export interface SkillSourcePort {
  global(): Promise<readonly SkillFile[]>;
  project(): Promise<readonly SkillFile[]>;
}
