import path from 'node:path';

import type { HeadlessInvocation } from './headless-args.types';

/** `--plan-file` (resolved against the working directory; read by the runner) and `--require-plan`. */
export function planFlags(
  values: ReadonlyMap<string, readonly string[]>,
  flags: ReadonlySet<string>,
  cwd: string,
): Partial<Pick<HeadlessInvocation, 'planFile' | 'requirePlan' | 'taskPlan'>> {
  const file = values.get('planFile')?.at(-1);
  return {
    ...(file === undefined ? {} : { planFile: path.resolve(cwd, file) }),
    ...(flags.has('--require-plan') ? { requirePlan: true as const } : {}),
    ...(flags.has('--task-plan') ? { taskPlan: true as const } : {}),
  };
}
