import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { orchestratePlanSchema } from '../../src/sdk/orchestrate-plan.schema';

const file = path.join(__dirname, '..', '..', 'schemas', 'clawai-orchestrate-plan.schema.json');
const generated = z.toJSONSchema(orchestratePlanSchema, { io: 'input' });

describe('clawai-orchestrate-plan.schema.json', () => {
  it('is the schema the runtime validates with (regenerate with scripts/orchestrate-schema)', () => {
    const onDisk: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it('accepts the worked example and rejects an unknown key, as an editor would', () => {
    const validator = z.fromJSONSchema(JSON.parse(readFileSync(file, 'utf8')));
    const plan = {
      name: 'p',
      goal: 'g',
      stages: [
        {
          id: 's',
          agents: [
            {
              name: 'a',
              task: 't',
              tools: ['read'],
              budget: { maxToolCalls: 5, maxDurationSec: 30 },
            },
          ],
        },
      ],
    };
    expect(validator.safeParse(plan).success).toBe(true);
    expect(validator.safeParse({ ...plan, extra: 1 }).success).toBe(false);
  });
});
