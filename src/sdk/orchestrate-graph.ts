import type { OrchestrateStage } from './orchestrate.types';

/** The stage graph as the checks and the engine read it. */
export interface StageGraph {
  /** Stage ids in an order that respects every dependency (ties keep the plan's order). */
  readonly order: readonly string[];
  /** Everything in one wave can start once the earlier waves are over. */
  readonly waves: readonly (readonly string[])[];
  /** For each stage, every stage it waits for, directly or not. */
  readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The ids of a dependency cycle, in order, found by walking the "waits for" edges. */
function findCycle(stages: readonly OrchestrateStage[]): readonly string[] {
  const edges = new Map(stages.map((stage) => [stage.id, stage.dependsOn]));
  const visiting: string[] = [];
  const done = new Set<string>();
  const visit = (id: string): readonly string[] | undefined => {
    const at = visiting.indexOf(id);
    if (at >= 0) return [...visiting.slice(at), id];
    if (done.has(id)) return undefined;
    visiting.push(id);
    for (const next of edges.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle !== undefined) return cycle;
    }
    visiting.pop();
    done.add(id);
    return undefined;
  };
  for (const stage of stages) {
    const cycle = visit(stage.id);
    if (cycle !== undefined) return cycle;
  }
  return [];
}

/**
 * The waves of a plan whose dependencies all name real stages, or the cycle that
 * stops it. A wave is every stage whose dependencies are all in earlier waves,
 * which is also the most that can run side by side.
 */
export function stageGraph(stages: readonly OrchestrateStage[]): StageGraph | readonly string[] {
  const waves: string[][] = [];
  const placed = new Set<string>();
  const ancestors = new Map<string, Set<string>>();
  while (placed.size < stages.length) {
    const wave = stages.filter(
      (stage) => !placed.has(stage.id) && stage.dependsOn.every((id) => placed.has(id)),
    );
    if (wave.length === 0) return findCycle(stages);
    for (const stage of wave) {
      const above = new Set<string>();
      for (const id of stage.dependsOn) {
        above.add(id);
        for (const inherited of ancestors.get(id) ?? []) above.add(inherited);
      }
      ancestors.set(stage.id, above);
    }
    for (const stage of wave) placed.add(stage.id);
    waves.push(wave.map((stage) => stage.id));
  }
  return { order: waves.flat(), waves, ancestors };
}

/** Whether two stages can be running at the same time: neither waits for the other, directly or not. */
export function unordered(graph: StageGraph, left: string, right: string): boolean {
  if (left === right) return true;
  return !graph.ancestors.get(left)?.has(right) && !graph.ancestors.get(right)?.has(left);
}
