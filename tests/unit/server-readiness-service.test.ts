import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { VscodeDevelopmentServiceReadiness } from '../../src/infrastructure/vscode-development-service-adapter';
import { ServerReadinessService } from '../../src/services/server-readiness-service';

describe('ServerReadinessService process evidence', () => {
  it('binds process state and logs to the admitted runtime run', async () => {
    const processEvidence = vi.fn(() => ({
      running: true,
      logs: 'server ready',
    }));
    const service = new ServerReadinessService(
      () => ({
        allowedOrigins: ['https://claw.local'],
        allowExternalNavigationWithApproval: false,
        allowDownloads: false,
        maxDownloadBytes: 1024,
      }),
      { evidence: processEvidence },
      vi.fn(async () => new Response('', { status: 200 })),
    );

    await expect(
      service.wait(
        { url: 'https://claw.local/health', processSessionId: 'process:owned-0001' },
        'runtime:owned-0001',
      ),
    ).resolves.toMatchObject({
      ready: true,
      processRunning: true,
      processLogs: 'server ready',
    });
    expect(processEvidence).toHaveBeenCalledWith('process:owned-0001', 'runtime:owned-0001');
  });

  it('uses the owned process receipt when checking development-service readiness', async () => {
    const processEvidence = vi.fn(() => ({ running: true, logs: 'ready' }));
    const readiness = new ServerReadinessService(
      () => ({
        allowedOrigins: ['https://claw.local'],
        allowExternalNavigationWithApproval: false,
        allowDownloads: false,
        maxDownloadBytes: 1024,
      }),
      { evidence: processEvidence },
      vi.fn(async () => new Response('', { status: 200 })),
    );
    const adapter = new VscodeDevelopmentServiceReadiness(readiness);

    await expect(
      adapter.wait(
        {
          serviceId: 'api',
          label: 'API',
          kind: 'process',
          targetId: 'target:workspace',
          dependencies: [],
          expectedPorts: [4000],
          readinessUrl: 'https://claw.local/health',
          environmentOverlay: {},
          restartPolicy: 'on-change',
          maxRestarts: 2,
          restartWindowMs: 60_000,
        },
        {
          instanceId: 'service:api-0001',
          serviceId: 'api',
          ownerRunId: 'runtime:owned-0001',
          targetId: 'target:workspace',
          lifecycle: 'starting',
          startedAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          restartCount: 0,
          processReceipt: {
            sessionId: 'process:owned-0001',
            ownerId: 'account:owned-0001',
            runId: 'runtime:owned-0001',
            targetId: 'target:workspace',
            pid: 1000,
            executableHash: `sha256:${'a'.repeat(64)}`,
            startedAt: '2026-08-02T00:00:00.000Z',
          },
          ports: [4000],
          recentLog: '',
          logTruncated: false,
        },
      ),
    ).resolves.toBe(true);
    expect(processEvidence).toHaveBeenCalledWith('process:owned-0001', 'runtime:owned-0001');
  });
});
