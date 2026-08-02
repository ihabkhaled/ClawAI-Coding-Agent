import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

import * as vscode from 'vscode';
import { z } from 'zod';

import { resolveExecutable } from './bounded-command-runner';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ServiceDefinition, ServiceInstance } from '../core/development-service';
import type { ContainerEngineService } from '../services/container-engine-service';
import type {
  ManagedServiceAdapterPort,
  ManagedServiceAdapterReceipt,
  ManagedServiceReadinessPort,
  PortInspectorPort,
  PortOwner,
  ServiceCheckpointPort,
} from '../services/development-service-manager';
import type { ProcessSupervisorService } from '../services/process-supervisor-service';
import type { ServerReadinessService } from '../services/server-readiness-service';

const processReceiptSchema = z.looseObject({
  sessionId: z.string().min(8),
  ownerId: z.string().min(1),
  runId: z.string().min(8),
  targetId: z.string().min(8),
  pid: z.number().int().positive(),
  executableHash: z.string(),
  startedAt: z.string(),
});
const composeReceiptSchema = z.looseObject({
  kind: z.literal('compose'),
  rootKey: z.string().min(1),
  composeFile: z.string().min(1),
  projectName: z.string().min(1),
});

export class VscodeDevelopmentServiceAdapter implements ManagedServiceAdapterPort {
  private readonly taskExecutions = new Map<string, vscode.TaskExecution>();

  constructor(
    private readonly processes: ProcessSupervisorService,
    private readonly containers: ContainerEngineService,
    private readonly files: VscodeFileTransactionAdapter,
    private readonly ownerId: () => string,
    private readonly workspaceId: () => string,
  ) {}

  async start(
    definition: ServiceDefinition,
    ownerRunId: string,
    signal?: AbortSignal,
  ): Promise<ManagedServiceAdapterReceipt> {
    signal?.throwIfAborted();
    if (definition.kind === 'process' && definition.command !== undefined) {
      const executablePath = await resolveExecutable(definition.command.executable);
      const cwd = await this.files.uriFor(
        definition.command.cwdRootKey,
        definition.command.cwd,
        'update',
      );
      const receipt = await this.processes.create({
        ownerId: this.ownerId(),
        runId: ownerRunId,
        targetId: definition.targetId,
        executablePath,
        arguments: definition.command.arguments,
        cwd: cwd.fsPath,
        environment: { ...definition.command.environment, ...definition.environmentOverlay },
        title: definition.label,
        expectedPorts: definition.expectedPorts,
        ...(definition.readinessPattern === undefined
          ? {}
          : { readinessPattern: definition.readinessPattern }),
      });
      return { identity: { ...receipt }, recentLog: '', logTruncated: false };
    }
    if (definition.kind === 'compose' && definition.containerOperation !== undefined) {
      const rootKey = z.string().parse(definition.containerOperation.rootKey);
      const composeFile = z
        .string()
        .parse(definition.containerOperation.composeFile ?? definition.containerOperation.file);
      const projectName = `clawai-${createHash('sha256')
        .update(`${this.workspaceId()}:${ownerRunId}`)
        .digest('hex')
        .slice(0, 16)}`;
      const receipt = await this.containers.execute(
        {
          operation: 'compose-up',
          engine: 'auto',
          rootKey,
          composeFile,
          projectName,
          services: [],
        },
        signal,
      );
      return {
        identity: { kind: 'compose', rootKey, composeFile, projectName },
        recentLog: receipt.output,
        logTruncated: false,
      };
    }
    if (definition.kind === 'vscode-task' && definition.containerOperation !== undefined) {
      const taskName = z.string().min(1).parse(definition.containerOperation.taskName);
      const tasks = await vscode.tasks.fetchTasks();
      const task = tasks.find((candidate) => candidate.name === taskName);
      if (task === undefined) throw new Error(`VS Code task ${taskName} is unavailable`);
      const key = `${ownerRunId}:${definition.serviceId}`;
      const execution = await vscode.tasks.executeTask(task);
      this.taskExecutions.set(key, execution);
      return {
        identity: { kind: 'vscode-task', key, taskName },
        recentLog: '',
        logTruncated: false,
      };
    }
    throw new Error('This discovered service requires a VS Code task adapter that is unavailable');
  }

  async stop(instance: ServiceInstance, signal?: AbortSignal): Promise<void> {
    if (instance.processReceipt?.kind === 'vscode-task') {
      const key = z.string().parse(instance.processReceipt.key);
      const execution = this.taskExecutions.get(key);
      if (execution === undefined)
        throw new Error('VS Code task execution is no longer owned by this host');
      execution.terminate();
      this.taskExecutions.delete(key);
      return;
    }
    if (instance.processReceipt?.kind === 'compose') {
      const receipt = composeReceiptSchema.parse(instance.processReceipt);
      await this.containers.execute(
        {
          operation: 'compose-down',
          engine: 'auto',
          rootKey: receipt.rootKey,
          composeFile: receipt.composeFile,
          projectName: receipt.projectName,
        },
        signal,
      );
      return;
    }
    await this.processes.terminate(processReceiptSchema.parse(instance.processReceipt));
  }

  inspect(instance: ServiceInstance): Promise<ManagedServiceAdapterReceipt> {
    if (instance.processReceipt?.kind === 'vscode-task') {
      const key = z.string().parse(instance.processReceipt.key);
      if (!this.taskExecutions.has(key)) throw new Error('VS Code task execution was lost');
      return Promise.resolve({
        identity: instance.processReceipt,
        recentLog: '',
        logTruncated: false,
      });
    }
    if (instance.processReceipt?.kind === 'compose') {
      return Promise.resolve({
        identity: instance.processReceipt,
        recentLog: instance.recentLog,
        logTruncated: instance.logTruncated,
      });
    }
    const snapshot = this.processes.snapshot(processReceiptSchema.parse(instance.processReceipt));
    return Promise.resolve({
      identity: { ...snapshot },
      recentLog: snapshot.log,
      logTruncated: snapshot.logTruncated,
    });
  }
}

export class VscodeDevelopmentServiceReadiness implements ManagedServiceReadinessPort {
  constructor(private readonly readiness: ServerReadinessService) {}

  async wait(
    definition: ServiceDefinition,
    instance: ServiceInstance,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (definition.readinessUrl === undefined) return true;
    try {
      await this.readiness.wait(
        {
          url: definition.readinessUrl,
          processId: instance.instanceId,
          timeoutMs: 120_000,
          intervalMs: 500,
          expectedStatuses: [200, 204, 301, 302, 307, 308],
        },
        signal,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export class VscodeServiceCheckpointStore implements ServiceCheckpointPort {
  private readonly key = 'clawAI.developmentServiceCheckpoints.v1';

  constructor(private readonly state: vscode.Memento) {}

  load(): Promise<readonly ServiceInstance[]> {
    return Promise.resolve(this.state.get<readonly ServiceInstance[]>(this.key) ?? []);
  }

  async save(instances: readonly ServiceInstance[]): Promise<void> {
    await this.state.update(this.key, instances);
  }
}

export class SocketPortInspector implements PortInspectorPort {
  async owners(ports: readonly number[], signal?: AbortSignal): Promise<readonly PortOwner[]> {
    const owners: PortOwner[] = [];
    for (const port of ports) {
      signal?.throwIfAborted();
      if (!(await this.available(port, signal))) {
        owners.push({
          pid: 1,
          executablePath: 'unknown-port-owner',
          executableHash: `sha256:${createHash('sha256')
            .update(`port:${String(port)}`)
            .digest('hex')}`,
          owner: 'unknown',
          startedAt: new Date(0).toISOString(),
          command: 'Identity unavailable; inspect the port owner before changing it.',
          port,
          ownedByClawAI: false,
        });
      }
    }
    return owners;
  }

  private available(port: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      const abort = () => {
        server.close();
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Port inspection cancelled'),
        );
      };
      const settle = (available: boolean) => {
        signal?.removeEventListener('abort', abort);
        resolve(available);
      };
      signal?.addEventListener('abort', abort, { once: true });
      server.once('error', () => {
        settle(false);
      });
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.close(() => {
          settle(true);
        });
      });
    });
  }
}
