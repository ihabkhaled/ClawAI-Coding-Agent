import { EFFORT_MODES } from '../core/effort-mode';
import { SPEED_MODES } from '../core/speed-mode';
import { contextProblem } from '../sdk/agent-context';
import { AGENT_RESEARCH_FLAG_VALUES } from '../sdk/web-toolkit.constants';

import { HEADLESS_CONTEXT_MODES } from './headless-args.constants';

import type { HeadlessInvocation } from './headless-args.types';
import type { ContextMode } from '../core/context-mode';
import type { EffortMode } from '../core/effort-mode';
import type { SpeedMode } from '../core/speed-mode';

type Values = ReadonlyMap<string, readonly string[]>;
type Controls = Partial<Pick<HeadlessInvocation, 'effort' | 'speed' | 'context' | 'research'>>;

const lastOf = (values: Values, field: string): string | undefined => values.get(field)?.at(-1);

const isEffort = (value: string): value is EffortMode => EFFORT_MODES.some((m) => m === value);
const isSpeed = (value: string): value is SpeedMode => SPEED_MODES.some((m) => m === value);
const isContextMode = (value: string): value is ContextMode =>
  HEADLESS_CONTEXT_MODES.some((m) => m === value);

function effortControl(raw: string | undefined): Controls | string {
  if (raw === undefined) return {};
  const mode = raw.toUpperCase();
  return isEffort(mode) ? { effort: mode } : `--effort must be one of ${EFFORT_MODES.join(', ')}.`;
}

function speedControl(raw: string | undefined): Controls | string {
  if (raw === undefined) return {};
  const mode = raw.toUpperCase();
  return isSpeed(mode) ? { speed: mode } : `--speed must be one of ${SPEED_MODES.join(', ')}.`;
}

function researchControl(raw: string | undefined): Controls | string {
  if (raw === undefined) return {};
  const research = AGENT_RESEARCH_FLAG_VALUES[raw.toLowerCase()];
  return research === undefined
    ? `--research must be one of ${Object.keys(AGENT_RESEARCH_FLAG_VALUES).join(', ')}.`
    : { research };
}

/**
 * `--context-mode`, `--context-file` and `--context-selection`, together.
 *
 * A context flag that the chosen mode would ignore is a mistake, not a
 * default: `--context-file` with mode `workspace` would otherwise send the
 * whole workspace and look as if the named file had been honoured.
 */
function contextControl(values: Values): Controls | string {
  const mode = lastOf(values, 'contextMode');
  const file = lastOf(values, 'contextFile');
  const selection = lastOf(values, 'contextSelection');
  if (mode === undefined) {
    return file === undefined && selection === undefined
      ? {}
      : '--context-file and --context-selection need --context-mode.';
  }
  if (!isContextMode(mode)) {
    return `--context-mode must be one of ${HEADLESS_CONTEXT_MODES.join(', ')}.`;
  }
  if (file !== undefined && mode !== 'file' && mode !== 'smart') {
    return `--context-file is used only with --context-mode file or smart, not ${mode}.`;
  }
  if (selection !== undefined && mode !== 'selection' && mode !== 'smart') {
    return `--context-selection is used only with --context-mode selection or smart, not ${mode}.`;
  }
  const context = { mode, file, selection };
  const problem = contextProblem(context);
  return problem ?? { context };
}

/**
 * The composer controls a headless run can set, validated before any request.
 *
 * Only flags that were given appear in the result. A string is the first
 * mistake found, and becomes exit 2.
 */
export function checkedControls(values: Values): Controls | string {
  const effort = effortControl(lastOf(values, 'effort'));
  if (typeof effort === 'string') return effort;
  const speed = speedControl(lastOf(values, 'speed'));
  if (typeof speed === 'string') return speed;
  const research = researchControl(lastOf(values, 'research'));
  if (typeof research === 'string') return research;
  const context = contextControl(values);
  if (typeof context === 'string') return context;
  return { ...effort, ...speed, ...research, ...context };
}
