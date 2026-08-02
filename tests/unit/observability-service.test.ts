import { describe, expect, it, vi } from 'vitest';

import { LocalObservabilityService } from '../../src/services/observability-service';

describe('LocalObservabilityService', () => {
  it('stays local by default and requires explicit approval before remote export', () => {
    const local = { emit: vi.fn(), emitMetrics: vi.fn() };
    const remote = { emit: vi.fn(), emitMetrics: vi.fn() };
    const service = new LocalObservabilityService(local, remote);
    const span = {
      name: 'runtime.v2.run',
      traceId: 'trace-id-0001',
      spanId: 'span-id-0001',
      startedAt: '2026-08-02T10:00:00.000Z',
      status: 'ok' as const,
      attributes: { tools: 13 },
    };

    service.emit(span);
    expect(local.emit).toHaveBeenCalledWith(span);
    expect(remote.emit).not.toHaveBeenCalled();
    expect(() => service.setRemoteExport(true, false)).toThrow('explicit approval');

    service.setRemoteExport(true, true);
    service.emit(span);
    expect(remote.emit).toHaveBeenCalledWith(span);
  });
});
