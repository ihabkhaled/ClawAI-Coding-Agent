import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { agentRemoteClient } from '../../src/backend/agent-remote-client';
import { publishArtifact } from '../../src/backend/artifact-client';
import { connectionOperationErrorMessage } from '../../src/backend/backend-error-message';
import { BackendRequestError } from '../../src/backend/backend-errors';
import { channelClient } from '../../src/backend/channel-client';
import { devicePairingClient } from '../../src/backend/device-pairing-client';
import { fetchOrganizationPolicy } from '../../src/backend/organization-policy-client';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { routineClient } from '../../src/backend/routine-client';
import { rewindThread } from '../../src/backend/thread-client';
import { fetchAccountUsageSections } from '../../src/backend/usage-breakdown-client';
import {
  CHAOS_SCENARIOS,
  PAIRING_HINT,
  SECRET_MARKERS,
  chaosClient,
} from '../helpers/chaos-backend';

import type { BackendClient } from '../../src/backend/backend-client';

const SETTLE_GUARD_MS = 3_000;
const BINDING = {
  threadId: 't',
  runId: 'r',
  generation: 'g',
  epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
};

/** Calls that make more than one request at once. */
const FAN_OUT = new Map([['usage breakdown', 2]]);

/** Every backend client added for the remote, integration and runtime surfaces. */
const CALLS: readonly (readonly [string, (client: BackendClient) => Promise<unknown>])[] = [
  ['rewind', (c) => rewindThread(c.remoteRequest, 't', 'm')],
  ['active-run', (c) => remoteSessionClient.activeRun(c.remoteRequest, 't')],
  ['runners (connected)', (c) => remoteSessionClient.connectedRunners(c.remoteRequest)],
  ['runners (all)', (c) => remoteSessionClient.allRunners(c.remoteRequest)],
  ['runner repos', (c) => remoteSessionClient.runnerRepos(c.remoteRequest, 's')],
  [
    'remote session dispatch',
    (c) =>
      remoteSessionClient.dispatch(c.remoteRequest, {
        sessionId: 's',
        workingDir: '.',
        command: 'ls',
      }),
  ],
  ['remote session task', (c) => remoteSessionClient.task(c.remoteRequest, 'x')],
  ['remote session commands', (c) => remoteSessionClient.sessionCommands(c.remoteRequest, 's')],
  ['remote session cancel', (c) => remoteSessionClient.cancelCommand(c.remoteRequest, 'x', 'why')],
  ['routines list', (c) => routineClient.list(c.integrationRequest)],
  ['routines devices', (c) => routineClient.devices(c.integrationRequest)],
  ['routines remove', (c) => routineClient.remove(c.integrationRequest, 'r')],
  ['routines status', (c) => routineClient.setStatus(c.integrationRequest, 'r', 'PAUSED')],
  ['channels read', (c) => channelClient(c.integrationRequest).read(10)],
  ['channels ack', (c) => channelClient(c.integrationRequest).ack('m')],
  ['channels webhook', (c) => channelClient(c.integrationRequest).webhook()],
  ['usage breakdown', (c) => fetchAccountUsageSections(c.usageRequest)],
  ['org policy', (c) => fetchOrganizationPolicy(c.usageRequest)],
  [
    'artifacts',
    (c) =>
      publishArtifact(c.artifactPost, {
        filename: 'a.md',
        mimeType: 'text/markdown',
        content: 'x',
        sha256: 'a'.repeat(64),
      }),
  ],
  ['deferred tools', (c) => c.loadRuntimeTools(BINDING, [])],
  ['device pairing start', (c) => devicePairingClient.start(c.agentKeyRequest, PAIRING_HINT)],
  ['device pairing poll', (c) => devicePairingClient.poll(c.agentKeyRequest, 'code-12345678')],
  ['runner heartbeat', (c) => agentRemoteClient.runnerHeartbeat(c.agentKeyRequest, 'key')],
];

async function settle(work: Promise<unknown>): Promise<{ error?: unknown }> {
  let guard: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    guard = setTimeout(() => {
      reject(new Error('the promise never settled'));
    }, SETTLE_GUARD_MS);
  });
  try {
    await Promise.race([work, timedOut]);
    return {};
  } catch (error: unknown) {
    return { error };
  } finally {
    clearTimeout(guard);
  }
}

describe.each(CHAOS_SCENARIOS)('chaos: $name', (scenario) => {
  it.each(CALLS)('%s settles, stays bounded and leaks nothing', async (name, call) => {
    const { fetcher, calls } = scenario.build();
    const client = await chaosClient(fetcher);

    const { error } = await settle(call(client));

    expect(calls()).toBeLessThanOrEqual(scenario.maxCalls * (FAN_OUT.get(name) ?? 1));
    if (error === undefined) return;
    expect(error, String(error)).toBeInstanceOf(BackendRequestError);
    const shown = connectionOperationErrorMessage(error);
    for (const secret of SECRET_MARKERS) {
      expect(shown).not.toContain(secret);
      expect((error as Error).message).not.toContain(secret);
    }
    expect(shown).not.toMatch(/Unexpected token|is not valid JSON|"code":|ZodError|\[\s*\{/u);
  });
});

describe('chaos: sign-out UI signal', () => {
  it('turns a rejected refresh into one terminal session-expired error', async () => {
    const scenario = CHAOS_SCENARIOS.find((s) => s.name === 'expired token, refresh rejected');
    if (scenario === undefined) throw new Error('scenario missing');
    const { fetcher } = scenario.build();
    const client = await chaosClient(fetcher);
    const { error } = await settle(remoteSessionClient.allRunners(client.remoteRequest));
    expect(error).toMatchObject({ name: 'BackendSessionExpiredError', status: 401 });
    expect(connectionOperationErrorMessage(error)).toBe(
      'Your ClawAI session expired. Reconnect to continue.',
    );
  });
});
