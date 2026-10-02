import { inspectProject, workspaceFolders } from './code-gates-detect';
import { GATE_NAMES } from './code-gates.constants';
import { DONE_CHECK_DEFAULT_TIMEOUT_MS } from './done-checks.constants';

import type { GateName } from './code-gates.types';
import type { DoneCheck } from './done-checks.types';

/** `lint,typecheck` as gate names, or the message naming the one that is not a gate. */
export function parseGateNames(values: readonly string[]): readonly GateName[] | string {
  const names: GateName[] = [];
  for (const raw of values.flatMap((value) => value.split(','))) {
    const word = raw.trim();
    if (word.length === 0) continue;
    const gate = GATE_NAMES.find((name) => name === word);
    if (gate === undefined) {
      return `--done-check-gates: "${word}" is not a gate; use ${GATE_NAMES.join(', ')}.`;
    }
    if (!names.includes(gate)) names.push(gate);
  }
  return names.length === 0 ? '--done-check-gates needs at least one gate.' : names;
}

function hasGates(workspace: string): boolean {
  const project = inspectProject(workspace, '.');
  return project !== undefined && Object.keys(project.gates).length > 0;
}

/** The folder whose gates stand for the workspace: the root project, else its only workspace folder. */
export function gateFolder(workspace: string): string | undefined {
  if (hasGates(workspace)) return '.';
  const dirs = workspaceFolders(workspace)?.dirs ?? [];
  if (dirs.length === 1) return dirs[0];
  return inspectProject(workspace, '.') === undefined ? undefined : '.';
}

/**
 * Turns `--done-check-gates lint,typecheck,test` into real done checks: the
 * command each gate resolves to in this workspace, so the run is only called
 * done when they exit 0. A gate the project cannot run is an error up front,
 * not a check that quietly passes.
 */
export function gateDoneChecks(
  gates: readonly GateName[],
  workspace: string,
): readonly DoneCheck[] | string {
  const dir = gateFolder(workspace);
  const project = dir === undefined ? undefined : inspectProject(workspace, dir);
  if (dir === undefined || project === undefined) {
    return '--done-check-gates: the workspace root is not a project; use --done-check for a folder.';
  }
  const checks: DoneCheck[] = [];
  for (const gate of gates) {
    const command = project.gates[gate];
    if (command === undefined) {
      return `--done-check-gates: no ${gate} command was found in ${dir} (no script or tool detected).`;
    }
    checks.push({
      label: `gate:${gate}`,
      executable: command.executable,
      args: command.args,
      ...(dir === '.' ? {} : { cwd: dir }),
      timeoutMs: DONE_CHECK_DEFAULT_TIMEOUT_MS,
    });
  }
  return checks;
}
