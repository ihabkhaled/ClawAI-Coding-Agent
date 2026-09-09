import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { policyRuleSchema, projectPolicySchema } from '../../src/core/policy-v2';
import { subAgentDefinitionSchema } from '../../src/core/sub-agent-definitions';

const root = join(__dirname, '..', '..');

function readSchema(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

function properties(node: Record<string, unknown>): Record<string, unknown> {
  const value = node.properties;
  if (value === null || typeof value !== 'object') {
    throw new Error('Expected a "properties" object on this JSON schema node');
  }
  return value as Record<string, unknown>;
}

function definitions(schema: Record<string, unknown>): Record<string, unknown> {
  const value = schema.definitions;
  if (value === null || typeof value !== 'object') {
    throw new Error('Expected a "definitions" object on this JSON schema');
  }
  return value as Record<string, unknown>;
}

/**
 * `contributes.jsonValidation` in package.json points VS Code's editor at
 * these hand-authored schema files for `.clawai` config, the same
 * hand-authored, sync-tested pattern `runtime-tool-input-schemas.ts` already
 * uses for the tool catalog — Zod v4 does have a native `toJSONSchema`, but
 * generating a file `contributes.jsonValidation` needs at edit time from a
 * `.ts` source would add a build step with no existing precedent in
 * `scripts/`, for a feature the audit itself calls cheap. This locks the two
 * representations to the same property set instead, so an editor field never
 * offers autocomplete for a key the real Zod validator would reject.
 */
describe('.clawai JSON schema files stay in sync with their Zod validators', () => {
  it('clawai-policy.schema.json offers exactly what projectPolicySchema accepts', () => {
    const schema = readSchema('schemas/clawai-policy.schema.json');

    expect(Object.keys(properties(schema)).sort()).toEqual(
      Object.keys(projectPolicySchema.shape).sort(),
    );
  });

  it('the policyRule definition offers exactly what policyRuleSchema accepts', () => {
    const schema = readSchema('schemas/clawai-policy.schema.json');
    const rule = definitions(schema).policyRule as Record<string, unknown>;

    expect(Object.keys(properties(rule)).sort()).toEqual(
      Object.keys(policyRuleSchema.shape).sort(),
    );
  });

  it('clawai-agents.schema.json offers exactly what subAgentDefinitionSchema accepts', () => {
    const schema = readSchema('schemas/clawai-agents.schema.json');
    const items = schema.items as Record<string, unknown>;

    expect(Object.keys(properties(items)).sort()).toEqual(
      Object.keys(subAgentDefinitionSchema.shape).sort(),
    );
  });
});

describe('package.json wires both schemas through contributes.jsonValidation', () => {
  it('points policy.json and agents.json at their schema files', () => {
    const manifest = readSchema('package.json');
    const jsonValidation = (manifest.contributes as Record<string, unknown>).jsonValidation as {
      fileMatch: string;
      url: string;
    }[];

    expect(jsonValidation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileMatch: '/.clawai/policies/policy.json',
          url: './schemas/clawai-policy.schema.json',
        }),
        expect.objectContaining({
          fileMatch: '/.clawai/agents/agents.json',
          url: './schemas/clawai-agents.schema.json',
        }),
      ]),
    );
  });
});
