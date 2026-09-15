import { describe, expect, it } from 'vitest';

import { gitOperationSchema } from '../../src/core/git-operation';
import { subAgentTaskSchema } from '../../src/core/multi-agent-dag';
import { runtimeToolInputSchemas } from '../../src/core/runtime/runtime-tool-input-schemas';

import type {
  RuntimeJsonObject,
  RuntimeJsonValue,
} from '../../src/core/runtime/runtime-json-value';

function asObject(value: RuntimeJsonValue | undefined): RuntimeJsonObject {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON schema object');
  }
  return value as RuntimeJsonObject;
}

function taskProperties(): RuntimeJsonObject {
  const agents = asObject(runtimeToolInputSchemas.agents);
  const graph = asObject(agents.properties);
  const graphSchema = asObject(graph.graph);
  const graphProperties = asObject(graphSchema.properties);
  const tasks = asObject(graphProperties.tasks);
  const items = asObject(tasks.items);
  return asObject(items.properties);
}

/**
 * `runtimeToolInputSchemas.agents` is the JSON schema shown to the model for
 * `runtime.agents run`; `subAgentTaskSchema` is what actually validates the
 * task it sends back, and is `.strict()` — an unrecognized key fails the
 * whole fork. A hand-authored `mandatoryGateIds` property once appeared on
 * the advertised task schema (copied from the unrelated `integrationRequest`
 * shape) without a matching Zod field, so a model that took the offer and
 * included it on a task had every sub-agent fork call rejected outright, with
 * no test catching it because nothing ever exercised the advertised property
 * set against the real validator. This locks the two in sync going forward:
 * every property the model is invited to send on a task must be one the
 * validator actually accepts.
 */
describe('runtime.agents fork task schema stays in sync with the validator', () => {
  it('offers only properties subAgentTaskSchema accepts', () => {
    const advertised = new Set(Object.keys(taskProperties()));
    const accepted = new Set(Object.keys(subAgentTaskSchema.shape));

    expect([...advertised].filter((key) => !accepted.has(key))).toEqual([]);
  });

  it('does not offer mandatoryGateIds on a sub-agent task', () => {
    expect(taskProperties()).not.toHaveProperty('mandatoryGateIds');
  });
});

/**
 * `workspace.git` advertises one flat property bag for every operation, and
 * `gitOperationSchema` is a `.strict()` discriminated union — a property
 * offered here that no variant accepts fails the same way the sub-agent
 * fork bug above did.
 */
describe('workspace.git schema stays in sync with the validator', () => {
  it('offers only properties some gitOperationSchema variant accepts', () => {
    const advertised = new Set(
      Object.keys(asObject(asObject(runtimeToolInputSchemas.git).properties)),
    );
    const accepted = new Set(
      gitOperationSchema.options.flatMap((variant) => Object.keys(variant.shape)),
    );

    expect([...advertised].filter((key) => !accepted.has(key))).toEqual([]);
  });
});
