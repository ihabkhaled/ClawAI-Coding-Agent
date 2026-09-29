import { describe, expect, it } from 'vitest';

import { reviewActionClient } from '../../src/backend/review-action-client';

import type { IntegrationRequester } from '../../src/backend/integration-contracts';

function requester(response: unknown): { request: IntegrationRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: IntegrationRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(response));
  };
  return { request, calls };
}

describe('reviewActionClient', () => {
  it('offers only connectors of the provider that can write', async () => {
    const { request, calls } = requester({
      data: [
        { id: 'c1', name: 'Mine', provider: 'GITHUB', status: 'ACTIVE', permissionLevel: 'WRITE' },
        { id: 'c2', name: 'Read', provider: 'GITHUB', status: 'ACTIVE', permissionLevel: 'READ' },
        { id: 'c3', name: 'Lab', provider: 'GITLAB', status: 'ACTIVE', permissionLevel: 'ADMIN' },
      ],
    });

    const connectors = await reviewActionClient.writableConnectors(request, 'GITHUB');

    expect(connectors.map((connector) => connector.id)).toEqual(['c1']);
    expect(calls[0]).toMatchObject({ path: '/workspace/connectors?provider=GITHUB&pageSize=100' });
  });

  it('drafts and then approves, the same two steps as the web approval center', async () => {
    const { request, calls } = requester({
      id: 'a/1',
      status: 'EXECUTED',
      result: { success: true, url: 'https://github.com/a/b/pull/1#issuecomment-9' },
    });

    const drafted = await reviewActionClient.draft(request, 'c1', {
      actionType: 'COMMENT_PR',
      payload: { owner: 'a', repo: 'b', pullNumber: 1, body: 'nit' },
    });
    const approved = await reviewActionClient.approve(request, drafted.id);

    expect(approved.result?.url).toContain('issuecomment-9');
    expect(calls).toEqual([
      {
        path: '/workspace/actions',
        options: {
          method: 'POST',
          body: {
            connectorId: 'c1',
            actionType: 'COMMENT_PR',
            payload: { owner: 'a', repo: 'b', pullNumber: 1, body: 'nit' },
          },
        },
      },
      { path: '/workspace/actions/a%2F1/approve', options: { method: 'POST', body: {} } },
    ]);
  });
});
