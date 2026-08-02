import { z } from 'zod';

import type { DevelopmentServiceDiscovery } from './development-service-discovery';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { DevelopmentServiceManager } from '../services/development-service-manager';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const developmentServiceToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.services',
  version: '2.0.0',
  description: 'Discover, launch, inspect, restart, and stop bounded owned development services.',
  operations: ['discover', 'register', 'restore', 'start', 'start-all', 'restart', 'stop', 'list'],
  riskClasses: ['inspect', 'process', 'destructive'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', additionalProperties: true },
};

const rootKeySchema = z.object({ rootKey: z.string().min(1).max(200) }).strict();
const serviceInputSchema = z.object({ serviceId: z.string().min(2).max(100) }).strict();

export class DevelopmentServiceToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly discovery: DevelopmentServiceDiscovery,
    private readonly manager: DevelopmentServiceManager,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== developmentServiceToolDefinition.name) {
      throw new Error('Unknown development service tool');
    }
    if (invocation.operation === 'discover') {
      const { rootKey } = rootKeySchema.parse(invocation.arguments);
      const discovered = await this.discovery.discover(rootKey, signal);
      return { structured: { services: discovered } };
    }
    if (invocation.operation === 'register') {
      const definitions = z.array(z.unknown()).max(1_000).parse(invocation.arguments.definitions);
      return { structured: { definitions: this.manager.register(definitions) } };
    }
    if (invocation.operation === 'restore') {
      await this.manager.restore();
      return { structured: { services: this.manager.snapshots() } };
    }
    if (invocation.operation === 'list') {
      return { structured: { services: this.manager.snapshots() } };
    }
    if (invocation.operation === 'start-all') {
      const serviceIds = z
        .array(z.string().min(2).max(100))
        .min(1)
        .max(100)
        .parse(invocation.arguments.serviceIds);
      return {
        structured: {
          services: await this.manager.startAll(serviceIds, invocation.runId, signal),
        },
      };
    }
    const { serviceId } = serviceInputSchema.parse(invocation.arguments);
    if (invocation.operation === 'start') {
      return {
        structured: { service: await this.manager.start(serviceId, invocation.runId, signal) },
      };
    }
    if (invocation.operation === 'restart') {
      return {
        structured: { service: await this.manager.restart(serviceId, invocation.runId, signal) },
      };
    }
    if (invocation.operation === 'stop') {
      await this.manager.stop(serviceId, invocation.runId, signal);
      return { structured: { stopped: true, serviceId } };
    }
    throw new Error('Unknown development service operation');
  }
}
