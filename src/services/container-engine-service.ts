import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  containerOperationSchema,
  type ContainerOperation,
  type ContainerOwnershipReceipt,
} from '../core/container-operation';
import { redactText } from '../core/redaction';
import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';

export interface ContainerOperationReceipt {
  readonly engine: 'docker' | 'podman';
  readonly operation: ContainerOperation['operation'];
  readonly output: string;
  readonly ownership?: ContainerOwnershipReceipt;
}

export class ContainerEngineService {
  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly ownerId: () => string,
    private readonly runId: () => string,
    private readonly workspaceId: () => string,
  ) {}

  async execute(candidate: unknown, signal?: AbortSignal): Promise<ContainerOperationReceipt> {
    const operation = containerOperationSchema.parse(candidate);
    const cwd = this.files.workspaceRootUri(operation.rootKey).fsPath;
    if (
      'projectName' in operation &&
      operation.operation.startsWith('compose-') &&
      operation.projectName !== this.expectedProjectName()
    )
      throw new Error(`Compose project must use the owned name ${this.expectedProjectName()}`);
    const engine = await this.engine(operation.engine, cwd, signal);
    if ('receipt' in operation) await this.assertOwned(operation.receipt, engine, cwd, signal);
    const result = await this.command(
      engine,
      this.arguments(operation),
      cwd,
      signal,
      operation.operation === 'exec' ? operation.stdin : undefined,
    );
    let ownership: ContainerOwnershipReceipt | undefined;
    if (operation.operation === 'run') {
      const resourceId = result.trim().split(/\s/u)[0];
      if (resourceId === undefined || resourceId.length === 0)
        throw new Error('Container engine returned no resource identity');
      ownership = await this.ownership(engine, resourceId, cwd, signal);
    }
    return {
      engine,
      operation: operation.operation,
      output: redactText(result).slice(0, 1_048_576),
      ...(ownership === undefined ? {} : { ownership }),
    };
  }

  private async engine(
    requested: ContainerOperation['engine'],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<'docker' | 'podman'> {
    const candidates: readonly ('docker' | 'podman')[] =
      requested === 'auto' ? ['docker', 'podman'] : [requested];
    for (const candidate of candidates) {
      try {
        await this.command(candidate, ['version', '--format', '{{json .}}'], cwd, signal);
        return candidate;
      } catch {
        /* try the next engine */
      }
    }
    throw new Error('No supported container engine is available');
  }

  private expectedProjectName(): string {
    return `clawai-${createHash('sha256')
      .update(`${this.workspaceId()}:${this.runId()}`)
      .digest('hex')
      .slice(0, 16)}`;
  }

  private arguments(operation: ContainerOperation): string[] {
    const inspectionOperations = new Set([
      'engine-info',
      'contexts',
      'images',
      'containers',
      'networks',
      'volumes',
      'logs',
      'stats',
      'inspect',
      'health',
    ]);
    const composeOperations = new Set([
      'compose-up',
      'compose-down',
      'compose-build',
      'compose-run',
      'compose-exec',
    ]);
    if (inspectionOperations.has(operation.operation)) return this.inspectionArguments(operation);
    if (composeOperations.has(operation.operation)) return this.composeArguments(operation);
    return this.lifecycleArguments(operation);
  }

  private inspectionArguments(operation: ContainerOperation): string[] {
    switch (operation.operation) {
      case 'engine-info':
        return ['info', '--format', '{{json .}}'];
      case 'contexts':
        return ['context', 'ls', '--format', '{{json .}}'];
      case 'images':
        return ['image', 'ls', '--format', '{{json .}}'];
      case 'containers':
        return ['container', 'ls', '--all', '--format', '{{json .}}'];
      case 'networks':
        return ['network', 'ls', '--format', '{{json .}}'];
      case 'volumes':
        return ['volume', 'ls', '--format', '{{json .}}'];
      case 'logs':
        return ['logs', '--tail', String(operation.tail), operation.resource];
      case 'stats':
        return ['stats', '--no-stream', '--format', '{{json .}}', operation.resource];
      case 'inspect':
      case 'health':
        return ['inspect', '--format', '{{json .}}', operation.resource];
      default:
        throw new Error('Unsupported container inspection operation');
    }
  }

  private lifecycleArguments(operation: ContainerOperation): string[] {
    switch (operation.operation) {
      case 'build':
        return [
          'build',
          '--file',
          operation.dockerfile,
          '--tag',
          operation.tag,
          operation.contextPath,
        ];
      case 'pull':
        return ['pull', operation.image];
      case 'run':
        return [
          'run',
          '--detach',
          '--name',
          operation.name,
          '--label',
          `com.clawai.owner=${this.ownerId()}`,
          '--label',
          `com.clawai.run=${this.runId()}`,
          '--label',
          `com.clawai.workspace=${this.workspaceId()}`,
          ...operation.ports.flatMap((port) => [
            '--publish',
            `${String(port.host)}:${String(port.container)}`,
          ]),
          ...Object.entries(operation.environment).flatMap(([key, value]) => [
            '--env',
            `${key}=${value}`,
          ]),
          operation.image,
          ...operation.arguments,
        ];
      case 'exec':
        return [
          'exec',
          ...(operation.stdin === undefined ? [] : ['--interactive']),
          operation.receipt.resourceId,
          operation.executable,
          ...operation.arguments,
        ];
      case 'start':
      case 'stop':
      case 'restart':
        return [operation.operation, operation.receipt.resourceId];
      case 'remove':
        return ['rm', operation.receipt.resourceId];
      default:
        throw new Error('Unsupported container lifecycle operation');
    }
  }

  private composeArguments(operation: ContainerOperation): string[] {
    switch (operation.operation) {
      case 'compose-up':
        return [
          'compose',
          '--file',
          operation.composeFile,
          '--project-name',
          operation.projectName,
          'up',
          '--detach',
          ...operation.services,
        ];
      case 'compose-down':
        return [
          'compose',
          '--file',
          operation.composeFile,
          '--project-name',
          operation.projectName,
          'down',
        ];
      case 'compose-build':
        return [
          'compose',
          '--file',
          operation.composeFile,
          '--project-name',
          operation.projectName,
          'build',
          ...operation.services,
        ];
      case 'compose-run':
        return [
          'compose',
          '--file',
          operation.composeFile,
          '--project-name',
          operation.projectName,
          'run',
          '--rm',
          operation.service,
          operation.executable,
          ...operation.arguments,
        ];
      case 'compose-exec':
        return [
          'compose',
          '--file',
          operation.composeFile,
          '--project-name',
          operation.projectName,
          'exec',
          operation.service,
          operation.executable,
          ...operation.arguments,
        ];
      default:
        throw new Error('Unsupported Compose operation');
    }
  }

  private async ownership(
    engine: 'docker' | 'podman',
    resourceId: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<ContainerOwnershipReceipt> {
    const labelsText = await this.command(
      engine,
      ['inspect', '--format', '{{json .Config.Labels}}', resourceId],
      cwd,
      signal,
    );
    const labelsCandidate: unknown = JSON.parse(labelsText);
    const labels = z.record(z.string(), z.unknown()).parse(labelsCandidate);
    if (
      labels['com.clawai.owner'] !== this.ownerId() ||
      labels['com.clawai.run'] !== this.runId() ||
      labels['com.clawai.workspace'] !== this.workspaceId()
    )
      throw new Error('Container ownership labels do not match this run');
    return {
      engine,
      resourceId,
      ownerId: this.ownerId(),
      runId: this.runId(),
      workspaceId: this.workspaceId(),
      labelsHash: `sha256:${createHash('sha256').update(labelsText).digest('hex')}`,
    };
  }

  private async assertOwned(
    receipt: ContainerOwnershipReceipt,
    engine: 'docker' | 'podman',
    cwd: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (receipt.engine !== engine) throw new Error('Container engine identity changed');
    const current = await this.ownership(engine, receipt.resourceId, cwd, signal);
    if (
      current.labelsHash !== receipt.labelsHash ||
      current.ownerId !== receipt.ownerId ||
      current.runId !== receipt.runId ||
      current.workspaceId !== receipt.workspaceId
    )
      throw new Error('Container ownership receipt is stale');
  }

  private async command(
    engine: 'docker' | 'podman',
    arguments_: string[],
    cwd: string,
    signal?: AbortSignal,
    stdin?: string,
  ): Promise<string> {
    const result = await runCommandSpec(
      {
        executable: engine,
        arguments: arguments_,
        cwdRootKey: 'internal',
        cwd: '.',
        environment: {},
        timeoutMs: 1_800_000,
        outputLimitBytes: 4_194_304,
        expectedEffect: 'local-mutation',
        targetId: 'target:container',
        elevation: false,
        ...(stdin === undefined ? {} : { stdin }),
      },
      cwd,
      signal,
    );
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `Container engine exited with ${String(result.exitCode)}`);
    return result.stdout;
  }
}
