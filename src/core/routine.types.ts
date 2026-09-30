export type RoutineStatus = 'ENABLED' | 'PAUSED' | 'DISABLED';

export interface RoutineInput {
  readonly deviceId: string;
  readonly name: string;
  readonly command: string;
  readonly intervalMinutes: number;
}

export type RoutineRefusal =
  'name' | 'command' | 'interval' | 'device' | 'prompt' | 'model' | 'repo' | 'labels';

export type RoutinePlan =
  | { readonly ok: true; readonly request: RoutineInput }
  | { readonly ok: false; readonly refusal: RoutineRefusal };

/** F099: an agent prompt run by an online runner carrying every label. */
export interface PromptRoutineInput {
  readonly name: string;
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly repoRef?: string | undefined;
  readonly runnerLabels: readonly string[];
  readonly intervalMinutes: number;
}

export type PromptRoutinePlan =
  | { readonly ok: true; readonly request: PromptRoutineInput }
  | { readonly ok: false; readonly refusal: RoutineRefusal };
