/**
 * A profile as the toolkit applies it: only ever a narrowing of what the run
 * already may do, never a grant.
 */
export interface ResolvedToolsProfile {
  /** Tool patterns the run is limited to; undefined means no limit (`full`). */
  readonly allow: readonly string[] | undefined;
  /** The profile asks for the `task.plan` tool (it grants no right of its own). */
  readonly taskPlan: boolean;
}
