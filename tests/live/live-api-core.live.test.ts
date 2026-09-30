/**
 * The live API lane, part: account, policy, threads, artifacts, channels. Excluded from `npm test`; run with
 * `npm run test:live-api`.
 *
 * Calls real routes through the extension's own clients and parses every
 * answer with the extension's own zod schemas, so a backend shape change fails
 * here rather than in a user's editor. Everything created is deleted at the
 * end, and the route table (status and shape per route) is printed and written
 * to `test-results/`.
 */
import { createHmac, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { publishArtifact } from '../../src/backend/artifact-client';
import { BackendRequestError } from '../../src/backend/backend-errors';
import { channelClient } from '../../src/backend/channel-client';
import {
  entitlementsSchema,
  paginatedSchema,
  runtimeProtocolWireDescriptorSchema,
  usageSchema,
  userProfileSchema,
} from '../../src/backend/contracts';
import { devicePairingClient } from '../../src/backend/device-pairing-client';
import { fetchOrganizationPolicy } from '../../src/backend/organization-policy-client';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { listThreads } from '../../src/backend/thread-client';
import { fetchAccountUsageSections } from '../../src/backend/usage-breakdown-client';
import {
  retentionRequestHeaders,
  ZeroRetentionRefusedError,
} from '../../src/backend/zero-retention-guard';
import { prepareArtifact } from '../../src/core/artifact-publication';
import { readMcpServerPolicy } from '../../src/core/mcp/mcp-server-policy';
import { organizationPolicySchema as policyV2OrganizationSchema } from '../../src/core/policy-v2';
import { zeroRetentionHeaders } from '../../src/core/zero-retention';

import {
  LIVE_BASE,
  defects,
  finishLane,
  liveAgentKeyRequester,
  onCleanup,
  pacedOnThrottle,
  rawCall,
  request,
  sha256,
  signIn,
  suffix,
  zdrRequest,
} from './live-api.helpers';
import { newThread } from './live-api.runtime-helpers';

import type { RawResult } from './live-api.helpers';

beforeAll(async () => {
  await signIn();
}, 120_000);

afterAll(async () => {
  const outcome = await finishLane('core');
  expect(outcome.shapeFailures).toEqual([]);
  expect(outcome.cleanupFailures).toEqual([]);
}, 300_000);

describe('live API lane: core', () => {
  it('auth, entitlements, usage, runtime protocol parse with the extension schemas', async () => {
    expect(await request('/auth/me', userProfileSchema)).toBeDefined();
    expect(await request('/auth/me/entitlements', entitlementsSchema)).toBeDefined();
    expect(await request('/auth/me/usage', usageSchema)).toBeDefined();
    const protocol = await request('/agent/runtime/protocol', runtimeProtocolWireDescriptorSchema);
    expect(protocol.versions).toContain('2.0');
  });

  it('usage breakdown parses; organization usage parses for an administered organization', async () => {
    const sections = await fetchAccountUsageSections(request);
    expect(sections.account, 'GET /auth/me/usage/breakdown failed or drifted').toBeDefined();
    expect(
      sections.organizations.length,
      'no organization usage came back for an owner/admin account',
    ).toBeGreaterThan(0);
  });

  it('organization policy effective parses, and rules, trust and mcpServers read with the extension parsers', async () => {
    const policy = await fetchOrganizationPolicy(request);
    expect(policy, 'strict organizationPolicySchema rejected the live policy').toBeDefined();
    const raw = await rawCall('GET', '/agent/organizations/policy/effective');
    const body: unknown = JSON.parse(raw.text);
    const constraints = policyV2OrganizationSchema.parse(body);
    expect(Array.isArray(constraints.rules)).toBe(true);
    expect(constraints.trust).toEqual(
      expect.objectContaining({
        repositories: expect.any(Array),
        domains: expect.any(Array),
        commands: expect.any(Array),
      }),
    );
    const mcp = readMcpServerPolicy(policy?.mcpServers);
    expect(mcp, 'mcpServers missing from the effective policy').toBeDefined();
    expect(
      mcp?.deny.some(
        (entry) => entry.name === '*' && (entry.reason ?? '').includes('could not be read'),
      ),
    ).toBe(false);
  });

  it('device pairing init and poll (public routes)', async () => {
    const start = await devicePairingClient.start(liveAgentKeyRequester, {
      name: `live-api-lane-${suffix}`,
      hostname: `live-api-lane-${suffix}`,
      os: 'windows',
      platform: 'win32',
      agentVersion: '0.0.0',
    });
    const poll = await devicePairingClient.poll(liveAgentKeyRequester, start.pairingCode);
    expect(poll.status).toBe('pending');
  });

  it('threads: coding-agent origin is stored and listed', async () => {
    const thread = await newThread(false, `live-api-lane-${suffix}`);
    const listed = await listThreads(request, 50);
    expect(listed.map((entry) => entry.id)).toContain(thread.id);
    const raw = await rawCall('GET', `/chat-threads/${thread.id}`);
    expect((JSON.parse(raw.text) as { origin?: string }).origin).toBe('CODING_AGENT');
    await remoteSessionClient.threadsFrom(request, 'web', 5);
  });

  it('extension refuses server-storing routes locally under zero retention, and sends the header otherwise', async () => {
    const attempt = zdrRequest('/artifacts', z.unknown(), { method: 'POST', body: {} });
    await expect(attempt).rejects.toBeInstanceOf(ZeroRetentionRefusedError);
    await expect(attempt).rejects.toMatchObject({ status: 403, retryable: false });
    await expect(
      zdrRequest('/files/upload', z.unknown(), { method: 'POST', body: {} }),
    ).rejects.toBeInstanceOf(ZeroRetentionRefusedError);
    expect(zeroRetentionHeaders({ active: true, source: 'setting' })).toEqual({
      'X-Claw-Zero-Retention': '1',
    });
    expect(retentionRequestHeaders('GET', '/auth/me', { active: false, source: 'off' })).toEqual(
      {},
    );
  });

  it('artifacts: publish, list, public read, delete; secret, hash, size and zero-retention refusals', async () => {
    const content = `# live api lane ${suffix}\n\nsafe text\n`;
    const prepared = prepareArtifact({ path: `docs/live-${suffix}.md`, content });
    if (prepared.status !== 'ready') throw new Error('the extension refused a plain markdown file');
    const outcome = await pacedOnThrottle(() =>
      publishArtifact(request, {
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        content: prepared.content,
        sha256: prepared.sha256,
        title: `Live lane ${suffix}`,
      }),
    );
    if (outcome.status !== 'published')
      throw new Error(`artifact route missing: ${outcome.detail}`);
    onCleanup(`artifact ${outcome.id}`, () => rawCall('DELETE', `/artifacts/${outcome.id}`));

    const publicId = outcome.url.split('/').at(-1) ?? '';
    const publicPath = `/public/artifacts/${publicId}`;
    const read = await rawCall('GET', publicPath, { token: null });
    expect(read.status).toBe(200);
    expect(read.text).toBe(prepared.content);
    expect(read.headers.get('content-type')).toMatch(/^text\/plain/u);
    expect(read.headers.get('x-content-type-options')).toMatch(/nosniff/u);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(read.headers.get('content-security-policy')).toMatch(/sandbox/u);
    if (!outcome.url.startsWith(LIVE_BASE)) {
      defects.push(`artifact url host differs from the API base: ${outcome.url}`);
    }

    const list = await request('/artifacts', paginatedSchema(z.object({ id: z.string() }).loose()));
    expect(list.data.map((entry) => entry.id)).toContain(outcome.id);

    const post = (
      body: Record<string, unknown>,
      headers: Record<string, string> = {},
    ): Promise<RawResult> => rawCall('POST', '/artifacts', { headers, body: JSON.stringify(body) });
    const good = {
      filename: `x-${suffix}.txt`,
      mimeType: 'text/plain',
      content: 'hello',
      sha256: sha256('hello'),
    };
    // Refusals must never be 404/405/501, which the client reads as "no such route".
    const secret = ['AK', 'IA', 'IOSFODNN7', 'EXAMPLE'].join('');
    const secretBody = `key ${secret}`;
    const refusedSecret = await post({ ...good, content: secretBody, sha256: sha256(secretBody) });
    expect(refusedSecret.status).toBe(422);
    const badHash = await post({ ...good, sha256: sha256('other') });
    expect(badHash.status).toBe(400);
    const nul = 'a\u0000b';
    expect((await post({ ...good, content: nul, sha256: sha256(nul) })).status).toBe(422);
    const big = 'x'.repeat(1_048_577);
    expect((await post({ ...good, content: big, sha256: sha256(big) })).status).toBe(413);
    const zdr = await post(good, { 'X-Claw-Zero-Retention': '1' });
    expect(zdr.status, 'backend zero-retention publish refusal').toBe(409);
    const leaked = await rawCall('GET', '/artifacts', { token: null });
    expect(leaked.status).toBe(401);

    expect((await rawCall('DELETE', `/artifacts/${outcome.id}`)).status).toBe(204);
    expect((await rawCall('GET', publicPath, { token: null })).status).toBe(404);
    expect((await rawCall('DELETE', `/artifacts/${outcome.id}`)).status).toBe(404);
  });

  it('artifacts: every content-type the extension labels is accepted by the backend', async () => {
    for (const extension of ['html', 'md', 'svg', 'json', 'csv', 'txt', 'unknownext']) {
      const prepared = prepareArtifact({
        path: `a/b/live-${suffix}.${extension}`,
        content: `body ${extension}\n`,
      });
      if (prepared.status !== 'ready') throw new Error(`extension blocked .${extension}`);
      const outcome = await pacedOnThrottle(() =>
        publishArtifact(request, {
          filename: prepared.filename,
          mimeType: prepared.mimeType,
          content: prepared.content,
          sha256: prepared.sha256,
        }),
      );
      expect(outcome.status, `.${extension} -> ${prepared.mimeType}`).toBe('published');
      if (outcome.status === 'published') {
        onCleanup(`artifact ${outcome.id}`, () => rawCall('DELETE', `/artifacts/${outcome.id}`));
      }
    }
  });

  it('artifacts: nothing the extension marks ready is refused by the backend secret scan', async () => {
    const random = (length: number): string =>
      randomBytes(length).toString('base64url').replaceAll(/[-_]/gu, 'x').slice(0, length);
    const samples = [
      ['gh', 'p_', random(36)].join(''),
      ['sk', '-', random(40)].join(''),
      ['sk', '-proj-', random(48)].join(''),
      ['AI', 'za', random(35)].join(''),
      ['xo', 'xb-', random(24)].join(''),
      ['sk_', 'live_', random(24)].join(''),
      ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
      ['postgres', '://user:', random(12), '@db.internal/x'].join(''),
      ['api_key', ' = ', random(24)].join(''),
      ['ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', random(43)].join(''),
    ];
    const leaks: string[] = [];
    for (const sample of samples) {
      const prepared = prepareArtifact({ path: 'notes.txt', content: `value: ${sample}\n` });
      if (prepared.status !== 'ready') continue;
      try {
        const outcome = await pacedOnThrottle(() =>
          publishArtifact(request, {
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            content: prepared.content,
            sha256: prepared.sha256,
          }),
        );
        if (outcome.status === 'published') {
          onCleanup(`artifact ${outcome.id}`, () => rawCall('DELETE', `/artifacts/${outcome.id}`));
        }
      } catch (error) {
        if (error instanceof BackendRequestError && error.status === 422) {
          leaks.push(`extension said ready, backend refused (422): ${sample.slice(0, 6)}...`);
        } else throw error;
      }
    }
    // Not a failure of the lane: the backend scan is a second line, and this reports the gap.
    if (leaks.length > 0) defects.push(...leaks);
    expect(leaks).toEqual([]);
  });

  it('channels: webhook info, HMAC-signed inbound, inbox read and ack', async () => {
    const client = channelClient(request);
    const info = await client.webhook();
    expect(info.signatureHeader).toBe('x-claw-signature');
    const url = new URL(info.url);
    if (!info.url.startsWith(LIVE_BASE.replace(/\/api\/v1$/u, ''))) {
      defects.push(`webhook url origin differs from the API base: ${url.origin}`);
    }
    const inboundPath = url.pathname.replace(/^\/api\/v1/u, '');
    const body = JSON.stringify({
      kind: 'ci',
      source: 'live-lane',
      title: `Live lane ${suffix}`,
      body: 'signed',
    });
    const sign = (timestamp: string, payload: string): string =>
      `sha256=${createHmac('sha256', info.secret).update(`${timestamp}.${payload}`).digest('hex')}`;
    const now = String(Math.floor(Date.now() / 1_000));

    const unsigned = await rawCall('POST', inboundPath, { token: null, body });
    expect(unsigned.status).toBe(401);
    const forged = await rawCall('POST', inboundPath, {
      token: null,
      body,
      headers: { [info.signatureHeader]: sign(now, 'tampered'), [info.timestampHeader]: now },
    });
    expect(forged.status).toBe(401);
    const stale = String(Math.floor(Date.now() / 1_000) - 3_600);
    const replay = await rawCall('POST', inboundPath, {
      token: null,
      body,
      headers: { [info.signatureHeader]: sign(stale, body), [info.timestampHeader]: stale },
    });
    expect(replay.status).toBe(401);
    const accepted = await rawCall('POST', inboundPath, {
      token: null,
      body,
      headers: { [info.signatureHeader]: sign(now, body), [info.timestampHeader]: now },
    });
    expect(accepted.status).toBe(202);
    const id = (JSON.parse(accepted.text) as { id: string }).id;
    onCleanup(`channel message ${id}`, () => rawCall('DELETE', `/agent/channels/inbox/${id}`));

    const inbox = await client.read(20);
    const mine = inbox.find((message) => message.id === id);
    expect(mine?.title).toBe(`Live lane ${suffix}`);
    await client.ack(id);
    expect((await client.read(20)).some((message) => message.id === id)).toBe(false);
    expect((await rawCall('DELETE', `/agent/channels/inbox/${id}`)).status).toBe(404);
  });
});
