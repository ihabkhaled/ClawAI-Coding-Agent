export interface HardenedGitCommand {
  readonly arguments: string[];
  readonly environment: Record<string, string>;
}
