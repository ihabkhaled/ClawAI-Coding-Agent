import { describe, expect, it } from 'vitest';

import { publishArtifact } from '../../src/backend/artifact-client';
import { BackendRequestError } from '../../src/backend/backend-errors';
import { BackendRuntimeClient } from '../../src/backend/backend-runtime-client';
import { channelClient } from '../../src/backend/channel-client';
import { fetchOrganizationPolicy } from '../../src/backend/organization-policy-client';
import { rewindThread } from '../../src/backend/thread-client';
import { fetchAccountUsageSections } from '../../src/backend/usage-breakdown-client';

import type { ToolDefinition } from '../../src/core/runtime/runtime-tool-contracts';

/** What every route answers on a backend that predates it. */
const notFound = async (): Promise<never> => {
  throw new BackendRequestError('ClawAI request failed (404).', 404, false);
};

describe('a backend that predates the route (404)', () => {
  it('leaves the organization policy undefined, so the client keeps working', async () => {
    await expect(fetchOrganizationPolicy(notFound)).resolves.toBeUndefined();
  });

  it('leaves the usage sections empty, so the dialog still opens', async () => {
    await expect(fetchAccountUsageSections(notFound)).resolves.toEqual({ organizations: [] });
  });

  it('reports a missing artifact route as route-missing, never as a success', async () => {
    const outcome = await publishArtifact(notFound, {
      filename: 'a.md',
      mimeType: 'text/markdown',
      content: 'x',
      sha256: 'a'.repeat(64),
    });
    expect(outcome.status).toBe('route-missing');
  });

  it('lets a missing rewind route reach the caller as an ordinary failure', async () => {
    await expect(rewindThread(notFound, 't', 'm')).rejects.toMatchObject({ status: 404 });
  });

  it('lets a missing deferred-tool route reach the caller as an ordinary failure', async () => {
    const client = new BackendRuntimeClient(notFound, notFound);
    const definition: ToolDefinition = {
      schemaVersion: '2.0',
      name: 'workspace.notebook',
      version: '2.0.0',
      description: 'Read a cell.',
      operations: ['read'],
      riskClasses: ['inspect'],
      targetIds: ['target:workspace'],
      inputSchema: { type: 'object' },
    };
    await expect(
      client.loadTools(
        {
          threadId: 't',
          runId: 'r',
          generation: 'g',
          epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
        },
        [definition],
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets a missing channel inbox reach the watcher, which owns the back-off', async () => {
    await expect(channelClient(notFound).read(10)).rejects.toMatchObject({ status: 404 });
  });
});
