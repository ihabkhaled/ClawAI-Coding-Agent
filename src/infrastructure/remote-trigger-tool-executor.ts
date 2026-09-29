import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { BackendRequestError } from '../backend/backend-errors';
import {
  MAX_REMOTE_INTERVAL_MINUTES,
  REMOTE_OUTPUT_TAIL_CHARACTERS,
  REMOTE_REFUSAL_STATUSES,
} from '../core/remote-job.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { RemoteCommand, RemoteJobPort } from '../backend/remote-job.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const remoteTriggerToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.remote',
  version: '1.0.0',
  description:
    "Remote jobs on the user's paired ClawAI devices. list shows jobs and the active devices. " +
    'create takes deviceId, name, command, intervalMinutes (1 to 10080) and optional workingDir; ' +
    'the job also repeats on that interval. trigger takes id and fires the job now; it carries an ' +
    'idempotencyKey (one is generated when omitted and returned) so retrying with the same key ' +
    'never runs the job twice. status takes commandId and reports the command state and output ' +
    'tail. A job runs only while its device holds a connected agent session, and the device still ' +
    'applies its own approval policy to the command.',
  operations: ['create', 'trigger', 'list', 'status'],
  riskClasses: ['inspect', 'network', 'external-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.remote,
};

const createSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(128),
  command: z.string().min(1).max(4_096),
  intervalMinutes: z.number().int().min(1).max(MAX_REMOTE_INTERVAL_MINUTES),
  workingDir: z.string().min(1).max(1_024).optional(),
});

const triggerSchema = z.object({
  id: z.string().trim().min(1).max(64),
  idempotencyKey: z
    .string()
    .regex(/^[\w.:-]{8,128}$/u)
    .optional(),
});

const statusSchema = z.object({ commandId: z.string().trim().min(1).max(64) });

function tail(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return text.length <= REMOTE_OUTPUT_TAIL_CHARACTERS
    ? text
    : text.slice(-REMOTE_OUTPUT_TAIL_CHARACTERS);
}

function describeCommand(command: RemoteCommand): Record<string, unknown> {
  return {
    commandId: command.id,
    status: command.status,
    exitCode: command.exitCode ?? null,
    rejectionReason: command.rejectionReason ?? null,
    stdoutTail: tail(command.stdout),
    stderrTail: tail(command.stderr),
  };
}

/**
 * RemoteTrigger (F029): create, fire, list and inspect remote jobs.
 *
 * A refusal the backend states plainly (not found, device offline, a key still
 * in flight) comes back as an ordinary result the model can read and act on;
 * anything else — auth, transport — propagates as a failure.
 */
export class RemoteTriggerToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly jobs: RemoteJobPort,
    private readonly newKey: () => string = randomUUID,
  ) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== remoteTriggerToolDefinition.name) {
      throw new Error('Unknown remote tool');
    }
    try {
      return { structured: await this.dispatch(invocation.operation, invocation.arguments) };
    } catch (error) {
      if (error instanceof BackendRequestError && REMOTE_REFUSAL_STATUSES.includes(error.status)) {
        return { structured: { ok: false, httpStatus: error.status, reason: error.message } };
      }
      throw error;
    }
  }

  private async dispatch(operation: string, args: unknown): Promise<Record<string, unknown>> {
    if (operation === 'list') return this.list();
    if (operation === 'create') return this.create(args);
    if (operation === 'trigger') return this.trigger(args);
    if (operation === 'status') return this.status(args);
    throw new Error('Unknown remote operation');
  }

  private async list(): Promise<Record<string, unknown>> {
    const listing = await this.jobs.list();
    return {
      jobs: listing.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        deviceId: job.deviceId,
        command: job.command,
        intervalMinutes: job.intervalMinutes,
        status: job.status,
        lastCommandId: job.lastCommandId ?? null,
        nextRunAt: job.nextRunAt,
      })),
      devices: listing.devices.map((device) => ({
        id: device.id,
        name: device.name,
        status: device.status,
      })),
    };
  }

  private async create(args: unknown): Promise<Record<string, unknown>> {
    const job = await this.jobs.create(createSchema.parse(args));
    return { ok: true, id: job.id, name: job.name, nextRunAt: job.nextRunAt };
  }

  private async trigger(args: unknown): Promise<Record<string, unknown>> {
    const input = triggerSchema.parse(args);
    const idempotencyKey = input.idempotencyKey ?? this.newKey();
    const fired = await this.jobs.trigger(input.id, idempotencyKey);
    return {
      ok: true,
      idempotencyKey,
      replayed: fired.replayed,
      ...describeCommand(fired.command),
    };
  }

  private async status(args: unknown): Promise<Record<string, unknown>> {
    const { commandId } = statusSchema.parse(args);
    return { ok: true, ...describeCommand(await this.jobs.status(commandId)) };
  }
}
