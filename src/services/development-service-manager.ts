import { randomUUID } from 'node:crypto';

import {
  orderServiceDefinitions,
  serviceDefinitionSchema,
  type ServiceDefinition,
  type ServiceInstance,
} from '../core/development-service';
import { redactText } from '../core/redaction';

export interface ManagedServiceAdapterReceipt {
  readonly identity: Readonly<Record<string, unknown>>;
  readonly recentLog: string;
  readonly logTruncated: boolean;
}

export interface ManagedServiceAdapterPort {
  start(
    definition: ServiceDefinition,
    ownerRunId: string,
    signal?: AbortSignal,
  ): Promise<ManagedServiceAdapterReceipt>;
  stop(instance: ServiceInstance, signal?: AbortSignal): Promise<void>;
  inspect(instance: ServiceInstance): Promise<ManagedServiceAdapterReceipt>;
}

export interface ManagedServiceReadinessPort {
  wait(
    definition: ServiceDefinition,
    instance: ServiceInstance,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

export interface PortOwner {
  readonly pid: number;
  readonly executablePath: string;
  readonly executableHash: string;
  readonly owner: string;
  readonly startedAt: string;
  readonly command: string;
  readonly port: number;
  readonly ownedByClawAI: boolean;
}

export interface PortInspectorPort {
  owners(ports: readonly number[], signal?: AbortSignal): Promise<readonly PortOwner[]>;
}

export interface ServiceCheckpointPort {
  load(): Promise<readonly ServiceInstance[]>;
  save(instances: readonly ServiceInstance[]): Promise<void>;
}

export class DevelopmentServiceManager {
  private readonly definitions = new Map<string, ServiceDefinition>();
  private readonly instances = new Map<string, ServiceInstance>();
  private readonly restartTimes = new Map<string, number[]>();

  constructor(
    private readonly adapter: ManagedServiceAdapterPort,
    private readonly readiness: ManagedServiceReadinessPort,
    private readonly ports: PortInspectorPort,
    private readonly checkpoints: ServiceCheckpointPort,
    private readonly now: () => number = Date.now,
  ) {}

  async restore(): Promise<void> {
    for (const instance of await this.checkpoints.load()) {
      try {
        const inspected = await this.adapter.inspect(instance);
        this.instances.set(instance.serviceId, this.withLog(instance, inspected));
      } catch {
        this.instances.set(instance.serviceId, {
          ...instance,
          lifecycle: 'lost',
          updatedAt: new Date(this.now()).toISOString(),
        });
      }
    }
    await this.persist();
  }

  register(candidates: readonly unknown[]): readonly ServiceDefinition[] {
    const definitions = candidates.map((candidate) => serviceDefinitionSchema.parse(candidate));
    orderServiceDefinitions(definitions);
    for (const definition of definitions) this.definitions.set(definition.serviceId, definition);
    return definitions;
  }

  async startAll(
    serviceIds: readonly string[],
    ownerRunId: string,
    signal?: AbortSignal,
  ): Promise<readonly ServiceInstance[]> {
    const selected = new Map<string, ServiceDefinition>();
    const include = (serviceId: string): void => {
      if (selected.has(serviceId)) return;
      const definition = this.requireDefinition(serviceId);
      selected.set(serviceId, definition);
      for (const dependency of definition.dependencies) include(dependency);
    };
    for (const serviceId of serviceIds) include(serviceId);
    const definitions = [...selected.values()];
    const levels = orderServiceDefinitions(definitions);
    for (const level of levels) {
      await Promise.all(
        level.map((definition) => this.start(definition.serviceId, ownerRunId, signal)),
      );
    }
    return serviceIds.map((serviceId) => this.requireInstance(serviceId));
  }

  async start(
    serviceId: string,
    ownerRunId: string,
    signal?: AbortSignal,
  ): Promise<ServiceInstance> {
    const definition = this.requireDefinition(serviceId);
    const conflicts = await this.ports.owners(definition.expectedPorts, signal);
    if (conflicts.length > 0) {
      const detail = conflicts
        .map(
          (owner) =>
            `${String(owner.port)} ${owner.executablePath} ${owner.executableHash} ${owner.owner}`,
        )
        .join('\n');
      throw new Error(`Service ports are already owned; explicit review is required:\n${detail}`);
    }
    const startedAt = new Date(this.now()).toISOString();
    const receipt = await this.adapter.start(definition, ownerRunId, signal);
    let instance: ServiceInstance = {
      instanceId: `service:${randomUUID()}`,
      serviceId,
      ownerRunId,
      targetId: definition.targetId,
      lifecycle: 'starting',
      startedAt,
      updatedAt: startedAt,
      restartCount: this.restartTimes.get(serviceId)?.length ?? 0,
      processReceipt: receipt.identity,
      ports: definition.expectedPorts,
      recentLog: redactText(receipt.recentLog).slice(-1_048_576),
      logTruncated:
        receipt.logTruncated || Buffer.byteLength(receipt.recentLog, 'utf8') > 1_048_576,
    };
    this.instances.set(serviceId, instance);
    await this.persist();
    const ready = await this.readiness.wait(definition, instance, signal);
    instance = {
      ...instance,
      lifecycle: ready ? 'ready' : 'unhealthy',
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.instances.set(serviceId, instance);
    await this.persist();
    return instance;
  }

  async restart(
    serviceId: string,
    ownerRunId: string,
    signal?: AbortSignal,
  ): Promise<ServiceInstance> {
    const definition = this.requireDefinition(serviceId);
    const now = this.now();
    const recent = (this.restartTimes.get(serviceId) ?? []).filter(
      (time) => now - time <= definition.restartWindowMs,
    );
    if (recent.length >= definition.maxRestarts) {
      const instance = this.requireInstance(serviceId);
      const crashLoop = {
        ...instance,
        lifecycle: 'crash-loop' as const,
        updatedAt: new Date(now).toISOString(),
      };
      this.instances.set(serviceId, crashLoop);
      await this.persist();
      throw new Error('Service restart budget exhausted; crash loop stopped');
    }
    this.restartTimes.set(serviceId, [...recent, now]);
    await this.stop(serviceId, ownerRunId, signal);
    return this.start(serviceId, ownerRunId, signal);
  }

  async stop(serviceId: string, ownerRunId: string, signal?: AbortSignal): Promise<void> {
    const instance = this.requireInstance(serviceId);
    if (instance.ownerRunId !== ownerRunId)
      throw new Error('Refusing to terminate an unowned service');
    await this.adapter.stop(instance, signal);
    this.instances.set(serviceId, {
      ...instance,
      lifecycle: 'stopped',
      updatedAt: new Date(this.now()).toISOString(),
    });
    await this.persist();
  }

  snapshots(): readonly ServiceInstance[] {
    return [...this.instances.values()];
  }

  private withLog(
    instance: ServiceInstance,
    receipt: ManagedServiceAdapterReceipt,
  ): ServiceInstance {
    return {
      ...instance,
      processReceipt: receipt.identity,
      recentLog: redactText(receipt.recentLog).slice(-1_048_576),
      logTruncated:
        receipt.logTruncated || Buffer.byteLength(receipt.recentLog, 'utf8') > 1_048_576,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private requireDefinition(serviceId: string): ServiceDefinition {
    const definition = this.definitions.get(serviceId);
    if (definition === undefined) throw new Error('Unknown development service');
    return definition;
  }

  private requireInstance(serviceId: string): ServiceInstance {
    const instance = this.instances.get(serviceId);
    if (instance === undefined) throw new Error('Development service is not running');
    return instance;
  }

  private persist(): Promise<void> {
    return this.checkpoints.save(this.snapshots());
  }
}
