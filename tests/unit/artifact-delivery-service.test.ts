import { describe, expect, it, vi } from 'vitest';

import { ArtifactDeliveryService } from '../../src/services/artifact-delivery-service';

import type { DeliveredArtifact } from '../../src/core/delivered-artifact';

function fakeState() {
  return { update: vi.fn<(patch: { artifacts: readonly DeliveredArtifact[] }) => void>() };
}

const report = { path: 'reports/audit.pdf', fsPath: 'C:\\w\\reports\\audit.pdf' };
const chart = { path: 'reports/chart.png', fsPath: 'C:\\w\\reports\\chart.png' };

describe('ArtifactDeliveryService', () => {
  it('publishes a delivery into the extension state', () => {
    const state = fakeState();
    const service = new ArtifactDeliveryService(state);

    service.record([report]);

    expect(state.update).toHaveBeenCalledWith({ artifacts: [report] });
    expect(service.current()).toEqual([report]);
  });

  it('accumulates across calls, newest first', () => {
    const service = new ArtifactDeliveryService(fakeState());

    service.record([report]);
    service.record([chart]);

    expect(service.current()).toEqual([chart, report]);
  });

  it('publishes nothing when a transaction delivered no artifacts', () => {
    const state = fakeState();
    const service = new ArtifactDeliveryService(state);

    service.record([]);

    expect(state.update).not.toHaveBeenCalled();
    expect(service.current()).toEqual([]);
  });

  it('clears on a boundary and publishes the empty list', () => {
    const state = fakeState();
    const service = new ArtifactDeliveryService(state);
    service.record([report]);

    service.clear();

    expect(service.current()).toEqual([]);
    expect(state.update).toHaveBeenLastCalledWith({ artifacts: [] });
  });
});
