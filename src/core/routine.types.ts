export type RoutineStatus = 'ENABLED' | 'PAUSED' | 'DISABLED';

export interface RoutineInput {
  readonly deviceId: string;
  readonly name: string;
  readonly command: string;
  readonly intervalMinutes: number;
}

export type RoutineRefusal = 'name' | 'command' | 'interval' | 'device';

export type RoutinePlan =
  | { readonly ok: true; readonly request: RoutineInput }
  | { readonly ok: false; readonly refusal: RoutineRefusal };
