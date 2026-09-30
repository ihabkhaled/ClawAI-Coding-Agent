import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: string[]) =>
      message.replace(/\{(\d+)\}/gu, (_match: string, index: string) => args[Number(index)] ?? ''),
  },
}));

import { BackendRequestError } from '../../src/backend/backend-errors';
import { fetchAccountUsageSections } from '../../src/backend/usage-breakdown-client';
import { accountUsageLines } from '../../src/services/show-usage-account';

import type { UsageRequester } from '../../src/backend/usage-breakdown-client.types';
import type { z } from 'zod';

const totals = { requests: 3, weightedTokens: 900, inputTokens: 40, outputTokens: 20 };

const account = {
  from: '2026-08-31T00:00:00.000Z',
  to: '2026-09-30T00:00:00.000Z',
  totals,
  bySurface: [{ surface: 'runtime-v2', ...totals }],
  byModel: [{ provider: 'gemini', model: 'flash', ...totals }],
};

function organization(id: string) {
  return {
    organizationId: id,
    from: account.from,
    to: account.to,
    memberCount: 2,
    totals,
    byMember: [{ userId: 'member-2', ...totals }],
    byModel: [{ provider: 'openai', model: 'gpt', ...totals }],
  };
}

function requester(answers: Record<string, unknown>): UsageRequester {
  return async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const answer = answers[path];
    if (answer === undefined || answer instanceof Error) {
      throw answer ?? new BackendRequestError('Not Found', 404, false);
    }
    return schema.parse(answer);
  };
}

describe('fetchAccountUsageSections', () => {
  it('reads the account breakdown and every administered organization', async () => {
    const sections = await fetchAccountUsageSections(
      requester({
        '/auth/me/usage/breakdown': account,
        '/agent/organizations': [
          { id: 'org-1', name: 'Acme' },
          { id: 'org-2', name: 'Other' },
        ],
        '/auth/me/organizations/org-1/usage': organization('org-1'),
        '/auth/me/organizations/org-2/usage': new BackendRequestError('Forbidden', 403, false),
      }),
    );

    expect(sections.account?.totals.weightedTokens).toBe(900);
    expect(sections.organizations.map((entry) => entry.name)).toEqual(['Acme']);
  });

  it('falls back silently when the backend has no breakdown endpoint', async () => {
    const sections = await fetchAccountUsageSections(requester({}));
    expect(sections).toEqual({ organizations: [] });
  });

  it('drops an answer that fails the contract instead of rendering it', async () => {
    const sections = await fetchAccountUsageSections(
      requester({
        '/auth/me/usage/breakdown': { ...account, totals: { ...totals, requests: 1.5 } },
      }),
    );
    expect(sections.account).toBeUndefined();
  });
});

describe('accountUsageLines', () => {
  it('renders the account and organization sections', () => {
    const text = accountUsageLines({
      account,
      organizations: [{ name: 'Acme', usage: organization('org-1') }],
    }).join('\n');

    expect(text).toContain('## This account (30 days)');
    expect(text).toContain('900 weighted tokens over 3 requests.');
    expect(text).toContain('| runtime-v2 | 3 | 40 | 20 | 900 |');
    expect(text).toContain('| gemini/flash | 3 | 40 | 20 | 900 |');
    expect(text).toContain('## Organization usage: Acme');
    expect(text).toContain('| member-2 | 3 | 40 | 20 | 900 |');
  });

  it('renders nothing when the backend answered nothing', () => {
    expect(accountUsageLines({ organizations: [] })).toEqual([]);
  });
});
