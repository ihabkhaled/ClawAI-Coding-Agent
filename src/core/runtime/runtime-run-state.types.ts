import type {
  RUNTIME_RUN_STATES,
  RUNTIME_RUN_TRANSITION_EVENTS,
} from './runtime-run-state.constants';

export type RuntimeRunState = (typeof RUNTIME_RUN_STATES)[number];

export type RuntimeRunTransitionEvent = (typeof RUNTIME_RUN_TRANSITION_EVENTS)[number];

/** Why `transition` said no. */
export type RuntimeRunTransitionRefusalReason = 'terminal-state' | 'illegal-transition';

export type RuntimeRunTransitionResult =
  | { readonly ok: true; readonly state: RuntimeRunState }
  | {
      readonly ok: false;
      readonly reason: RuntimeRunTransitionRefusalReason;
      readonly from: RuntimeRunState;
      readonly event: RuntimeRunTransitionEvent;
    };
