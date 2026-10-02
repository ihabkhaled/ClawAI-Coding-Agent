/** Where a step stands. Only `done` ends it, and a step with a check is `done` only once the check passes. */
export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'blocked';

/** The command that proves a step: run without a shell, in the workspace, exit 0 means pass. */
export interface PlanStepCheck {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number | undefined;
  /** Relative to the workspace root, and contained in it. */
  readonly cwd?: string | undefined;
}

/** One step of the plan as stored. */
export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStepStatus;
  readonly check?: PlanStepCheck;
  /** True for a step that came from the orchestrator (`--plan-file`): the model cannot drop or weaken it. */
  readonly locked?: true;
  /** True once the step's check passed, so a `done` step with a check is proven, not claimed. */
  readonly verified?: true;
  readonly note?: string;
}

/** A step as the model or the orchestrator writes it, before it is validated. */
export interface PlanStepInput {
  readonly id?: string | undefined;
  readonly title: string;
  readonly check?: PlanStepCheck | undefined;
}

/** What the plan file holds. */
export interface PlanFile {
  readonly version: 1;
  readonly steps: readonly PlanStep[];
}

/** Step counts, as a `run.plan` event reports them. */
export interface PlanSummary {
  readonly total: number;
  readonly todo: number;
  readonly doing: number;
  readonly done: number;
  readonly blocked: number;
}

/** The plan of one conversation, in memory and on disk. */
export interface PlanStore {
  list(): readonly PlanStep[];
  save(steps: readonly PlanStep[]): void;
  clear(): void;
}

/** What the plan tool needs from the toolkit that owns it. */
export interface PlanToolDeps {
  readonly workspace: string;
  /** Called after every change with the new counts. */
  readonly onChanged?: ((summary: PlanSummary) => void) | undefined;
  /** Whether a check the MODEL wrote may run at all (the `command` grant), and which executables. */
  readonly modelChecks: {
    readonly allowed: boolean;
    readonly executables: readonly string[];
    /** Asks the caller before a model-written check runs, in the permission modes that ask. */
    readonly approve?:
      ((check: PlanStepCheck, id: string) => boolean | Promise<boolean>) | undefined;
  };
}

/** What `update ... done` returns when the step's check fails: the step stays as it was. */
export interface PlanRefusal {
  readonly refused: true;
  readonly step: string;
  /** The status the step still has. */
  readonly status: PlanStepStatus;
  readonly message: string;
  /** The end of the check's output, redacted. */
  readonly checkOutputEnd: string;
}

/** The tool as the executor sees it. */
export interface PlanTool {
  execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): unknown;
}

/** What the completion gate says when the plan does not allow the run to end. */
export interface PlanGateReport {
  /** Steps not yet done; 0 when the plan is missing and required. */
  readonly open: number;
  readonly total: number;
  readonly prompt: string;
}

/** Asked once a run reports itself done: is the plan finished? Undefined means yes, or no plan is in force. */
export type PlanGate = () => PlanGateReport | undefined;
