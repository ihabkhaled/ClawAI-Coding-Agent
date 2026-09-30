/**
 * Where a plugin's hook approval stands.
 *
 * `off`: never approved. `approved`: approved for exactly these commands.
 * `changed`: approved once, but the commands or version moved since.
 * `legacy`: approved before approvals recorded a digest, so it proves nothing.
 */
export type HookApprovalStatus = 'approved' | 'changed' | 'legacy' | 'off';

export interface HookApproval {
  readonly status: HookApprovalStatus;
  /** The commands to show a person: the new or changed ones, else all of them. */
  readonly changedCommands: readonly string[];
}
