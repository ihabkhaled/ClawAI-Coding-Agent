import { describe, expect, it } from 'vitest';

import { DevelopmentServiceManager } from '../../src/services/development-service-manager';

import type { ServiceDefinition, ServiceInstance } from '../../src/core/development-service';
import type {
  ManagedServiceAdapterPort,
  ServiceCheckpointPort,
} from '../../src/services/development-service-manager';

const definition = (serviceId: string, dependencies: string[] = []): ServiceDefinition => ({
  serviceId,
  label: serviceId,
  kind: 'vscode-task',
  targetId: 'target:workspace',
  dependencies,
  expectedPorts: [],
  environmentOverlay: {},
  restartPolicy: 'on-change',
  maxRestarts: 1,
  restartWindowMs: 60_000,
});

class MemoryCheckpoint implements ServiceCheckpointPort {
  instances: readonly ServiceInstance[] = [];
  async load(): Promise<readonly ServiceInstance[]> {
    return this.instances;
  }
  async save(instances: readonly ServiceInstance[]): Promise<void> {
    this.instances = instances;
  }
}

describe('DevelopmentServiceManager', () => {
  it('starts dependency layers, persists state, and refuses unowned termination', async () => {
    const calls: string[] = [];
    const adapter: ManagedServiceAdapterPort = {
      start: async (service) => {
        calls.push(service.serviceId);
        return { identity: { serviceId: service.serviceId }, recentLog: '', logTruncated: false };
      },
      stop: async () => undefined,
      inspect: async (instance) => ({
        identity: instance.processReceipt ?? {},
        recentLog: '',
        logTruncated: false,
      }),
    };
    const checkpoints = new MemoryCheckpoint();
    const manager = new DevelopmentServiceManager(
      adapter,
      { wait: async () => true },
      { owners: async () => [] },
      checkpoints,
      () => Date.parse('2026-08-02T00:00:00.000Z'),
    );
    manager.register([definition('database'), definition('api', ['database'])]);
    const instances = await manager.startAll(['api'], 'run:owner-0001');
    expect(calls).toEqual(['database', 'api']);
    expect(instances[0]?.lifecycle).toBe('ready');
    expect(checkpoints.instances).toHaveLength(2);
    await expect(manager.stop('api', 'run:other-0001')).rejects.toThrow(/unowned/u);
  });

  it('stops restart storms at the configured budget', async () => {
    const adapter: ManagedServiceAdapterPort = {
      start: async () => ({ identity: {}, recentLog: '', logTruncated: false }),
      stop: async () => undefined,
      inspect: async () => ({ identity: {}, recentLog: '', logTruncated: false }),
    };
    let now = 1_000;
    const manager = new DevelopmentServiceManager(
      adapter,
      { wait: async () => true },
      { owners: async () => [] },
      new MemoryCheckpoint(),
      () => now,
    );
    manager.register([definition('frontend')]);
    await manager.start('frontend', 'run:owner-0001');
    now += 1;
    await manager.restart('frontend', 'run:owner-0001');
    now += 1;
    await expect(manager.restart('frontend', 'run:owner-0001')).rejects.toThrow(/crash loop/u);
    expect(manager.snapshots()[0]?.lifecycle).toBe('crash-loop');
  });
});
