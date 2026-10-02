import { parseSteps } from '../sdk/task-plan-steps';

import type { PlanStepInput } from '../sdk/task-plan-tool.types';

/**
 * The steps in a `--plan-file` JSON text, or the message naming what is wrong.
 * The file is an array of `{ id?, title, check?: { executable, args[], timeoutMs?, cwd? } }`,
 * or an object with that array as `steps`. Every step is validated now, so a bad file is a
 * usage error before any request is made.
 */
export function parsePlanFile(text: string): readonly PlanStepInput[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '--plan-file is not valid JSON.';
  }
  const list =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).steps
      : parsed;
  try {
    return parseSteps(list, true).map(({ id, title, check }) => ({ id, title, check }));
  } catch (error) {
    return `--plan-file: ${error instanceof Error ? error.message : 'the steps are not valid.'}`;
  }
}
