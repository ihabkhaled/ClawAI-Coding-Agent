import { afterEach, describe, expect, it } from 'vitest';

import { cleanTeamFixtures, runTeam } from '../helpers/team-fixture';

afterEach(cleanTeamFixtures);

const AGENT = 'agent.team';

describe('agent.team: one budget, spent once', () => {
  it('B01 calls a child spends come out of the parent allowance, not on top of it', async () => {
    let leadCalls = 0;
    let childCalls = 0;
    const run = await runTeam({
      maxToolCalls: 14,
      lead: async (api) => {
        leadCalls += 1;
        await api.call(AGENT, 'spawn', {
          name: 'kid',
          task: 't',
          tools: ['read'],
          budget: { maxToolCalls: 8 },
        });
        leadCalls += 1;
        await api.call(AGENT, 'wait', { timeoutMs: 20_000 });
        for (let index = 0; index < 40; index += 1) {
          const out = await api.call(AGENT, 'status', {});
          if (!out.ok) break;
          leadCalls += 1;
        }
      },
      children: {
        kid: async (api) => {
          for (let index = 0; index < 8; index += 1) {
            const out = await api.call(AGENT, 'inbox', {});
            if (out.ok) childCalls += 1;
          }
        },
      },
    });
    expect(childCalls).toBe(8);
    expect(leadCalls + childCalls).toBeLessThanOrEqual(14);
    expect(run.result.toolCalls).toBeLessThanOrEqual(14);
  });

  it('B02 a grandchild budget is carved from its parent, which is carved from the lead', async () => {
    let total = 0;
    await runTeam({
      maxToolCalls: 30,
      lead: async (api) => {
        await api.call(AGENT, 'spawn', {
          name: 'mid',
          task: 't',
          tools: ['read', 'agents'],
          budget: { maxToolCalls: 16 },
        });
        await api.call(AGENT, 'wait', { timeoutMs: 20_000 });
      },
      children: {
        mid: async (api) => {
          const out = await api.call(AGENT, 'spawn', {
            name: 'leaf',
            task: 't',
            tools: ['read'],
            budget: { maxToolCalls: 2_000 },
          });
          total += out.ok ? (out.structured.budget as { maxToolCalls: number }).maxToolCalls : 0;
          await api.call(AGENT, 'wait', { timeoutMs: 20_000 });
        },
        leaf: async () => undefined,
      },
    });
    expect(total).toBeLessThanOrEqual(16);
  });
});
