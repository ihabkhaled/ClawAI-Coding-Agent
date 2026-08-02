import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { ProcessSupervisorService } from '../services/process-supervisor-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const receiptSchema = z
  .object({
    sessionId: z.string().min(8).max(200),
    ownerId: z.string().min(1).max(200),
    runId: z.string().min(8).max(200),
    targetId: z.string().min(8).max(200),
    pid: z.number().int().positive(),
    executableHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    startedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const receiptInput = z.object({ receipt: receiptSchema }).strict();
const createInputSchema = z
  .object({
    executablePath: z.string().min(1).max(4_096),
    arguments: z.array(z.string().max(32_768)).max(1_000).default([]),
    cwdRootKey: z.string().min(1).max(100),
    cwd: z.string().min(1).max(4_096).default('.'),
    environment: z.record(z.string(), z.string().max(32_768)).default({}),
    columns: z.number().int().min(20).max(500).default(120),
    rows: z.number().int().min(5).max(200).default(30),
    title: z.string().min(1).max(200),
    readinessPattern: z.string().max(1_000).optional(),
    expectedPorts: z.array(z.number().int().min(1).max(65_535)).max(100).default([]),
  })
  .strict();

export const processSupervisorToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.process',
  version: '2.0.0',
  description: 'Create and control owned PTY and background process sessions.',
  operations: [
    'create',
    'write',
    'resize',
    'inspect',
    'interrupt',
    'terminate',
    'pause',
    'resume',
    'dispose',
    'join',
    'race',
  ],
  riskClasses: ['process', 'destructive'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.process,
};

export class ProcessSupervisorToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly supervisor: ProcessSupervisorService,
    private readonly ownerId: () => string,
    private readonly files: VscodeFileTransactionAdapter,
  ) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== processSupervisorToolDefinition.name)
      throw new Error('Unknown process supervisor tool');
    if (invocation.operation === 'create') return this.create(invocation);
    if (invocation.operation === 'join' || invocation.operation === 'race')
      return this.joinOrRace(invocation);
    return this.control(invocation);
  }

  private async create(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    const input = createInputSchema.parse(invocation.arguments);
    this.files.workspaceRootUri(input.cwdRootKey);
    const cwd = await this.files.uriFor(input.cwdRootKey, input.cwd, 'update');
    const receipt = await this.supervisor.create({
      executablePath: input.executablePath,
      arguments: input.arguments,
      cwd: cwd.fsPath,
      environment: input.environment,
      columns: input.columns,
      rows: input.rows,
      title: input.title,
      expectedPorts: input.expectedPorts,
      ...(input.readinessPattern === undefined ? {} : { readinessPattern: input.readinessPattern }),
      ownerId: this.ownerId(),
      runId: invocation.runId,
      targetId: invocation.targetId,
    });
    return { structured: { receipt } };
  }

  private async joinOrRace(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    const receipts = z
      .object({ receipts: z.array(receiptSchema).min(1).max(32) })
      .strict()
      .parse(invocation.arguments).receipts;
    const result =
      invocation.operation === 'join'
        ? await this.supervisor.join(receipts)
        : await this.supervisor.race(receipts);
    return { structured: { result } };
  }

  private async control(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    const receipt = receiptInput.parse(invocation.arguments).receipt;
    if (invocation.operation === 'inspect')
      return { structured: { process: this.supervisor.snapshot(receipt) } };
    if (invocation.operation === 'write') {
      const data = z
        .object({ receipt: receiptSchema, data: z.string().max(65_536) })
        .strict()
        .parse(invocation.arguments).data;
      this.supervisor.write(receipt, data);
    } else if (invocation.operation === 'resize') {
      const size = z
        .object({ receipt: receiptSchema, columns: z.number().int(), rows: z.number().int() })
        .strict()
        .parse(invocation.arguments);
      this.supervisor.resize(receipt, size.columns, size.rows);
    } else if (invocation.operation === 'interrupt') this.supervisor.interrupt(receipt);
    else if (invocation.operation === 'terminate') await this.supervisor.terminate(receipt);
    else if (invocation.operation === 'pause') this.supervisor.pause(receipt);
    else if (invocation.operation === 'resume') this.supervisor.resume(receipt);
    else if (invocation.operation === 'dispose') await this.supervisor.disposeSession(receipt);
    else throw new Error('Unknown process supervisor operation');
    return { structured: { accepted: true, operation: invocation.operation } };
  }
}
