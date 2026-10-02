import { toolsProfileProblem } from '../sdk/tools-profile';

import type { HeadlessInvocation } from './headless-args.types';

type ToolsFlags = Partial<Pick<HeadlessInvocation, 'toolsProfile' | 'deferTools'>>;

/**
 * `--tools-profile` and `--defer-tools`: the two ways to make the tool catalog
 * cheaper. Neither grants anything; a string is the first mistake found.
 */
export function toolsFlags(
  values: ReadonlyMap<string, readonly string[]>,
  flags: ReadonlySet<string>,
): ToolsFlags | string {
  const profile = values.get('toolsProfile')?.at(-1);
  const problem = profile === undefined ? undefined : toolsProfileProblem(profile);
  if (problem !== undefined) return `--tools-profile: ${problem}`;
  return {
    ...(profile === undefined ? {} : { toolsProfile: profile }),
    ...(flags.has('--defer-tools') ? { deferTools: true as const } : {}),
  };
}
