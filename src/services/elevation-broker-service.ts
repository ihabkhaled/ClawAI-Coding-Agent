import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  elevationDigest,
  elevationReceiptSchema,
  elevationRecipeSchema,
  ElevationReplayGuard,
  type ElevationEnvelope,
  type ElevationRecipe,
  type ElevationReceipt,
} from '../core/elevation-contract';
import { resolveExecutable } from '../infrastructure/bounded-command-runner';

import type { CommandResult } from '../core/command-spec';

export interface NativeElevationPort {
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly interactive: boolean;
  signRequest(unsigned: Omit<ElevationEnvelope, 'signature'>): Promise<string>;
  execute(envelope: ElevationEnvelope, signal?: AbortSignal): Promise<unknown>;
  verifyReceipt(receipt: ElevationReceipt): Promise<boolean>;
  helperIdentity(): Promise<{
    readonly identity: string;
    readonly binaryHash: string;
    readonly trusted: boolean;
  }>;
}

export interface ElevationConsentPort {
  confirm(recipe: ElevationRecipe, signal?: AbortSignal): Promise<boolean>;
}

export interface ElevationBinding {
  readonly runId: string;
  readonly workspaceId: string;
  readonly targetId: string;
  readonly parentPid: number;
  readonly workspaceRoot: string;
}

export interface ElevationVerificationPort {
  execute(
    recipe: ElevationRecipe,
    workspaceRoot: string,
    signal?: AbortSignal,
  ): Promise<CommandResult>;
}

interface ElevationHelperIdentity {
  readonly identity: string;
  readonly binaryHash: string;
  readonly trusted: boolean;
}

interface ResolvedElevationCommand {
  readonly cwd: string;
  readonly executableHash: string;
  readonly executablePath: string;
  readonly workspaceRoot: string;
}

export class ElevationBrokerService {
  private readonly replay = new ElevationReplayGuard();

  constructor(
    private readonly native: NativeElevationPort,
    private readonly consent: ElevationConsentPort,
    private readonly verification: ElevationVerificationPort,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(
    candidate: unknown,
    binding: ElevationBinding,
    signal?: AbortSignal,
  ): Promise<ElevationReceipt> {
    const recipe = elevationRecipeSchema.parse(candidate);
    this.assertInteractiveTarget();
    const helper = await this.trustedHelper();
    await this.requireConsent(recipe, signal);
    signal?.throwIfAborted();
    const command = await this.resolveCommand(recipe, binding);
    const now = this.now();
    const unsigned = this.unsignedEnvelope(recipe, binding, command, now);
    const envelope = { ...unsigned, signature: await this.native.signRequest(unsigned) };
    this.replay.consume(envelope.nonce, envelope.expiresAt, now);
    const receipt = elevationReceiptSchema.parse(await this.native.execute(envelope, signal));
    this.assertMatchingReceipt(receipt, envelope, helper);
    await this.assertSuccessfulReceipt(receipt);
    await this.verifyOutcome(recipe, command.workspaceRoot, signal);
    return receipt;
  }

  private assertInteractiveTarget(): void {
    if (!this.native.interactive)
      throw new Error('Elevation requires an interactive native target');
  }

  private async trustedHelper(): Promise<ElevationHelperIdentity> {
    const helper = await this.native.helperIdentity();
    if (!helper.trusted)
      throw new Error('The native elevation helper is missing or its signature is invalid');
    return helper;
  }

  private async requireConsent(recipe: ElevationRecipe, signal?: AbortSignal): Promise<void> {
    if (!(await this.consent.confirm(recipe, signal)))
      throw new Error('Elevation was not approved');
  }

  private async resolveCommand(
    recipe: ElevationRecipe,
    binding: ElevationBinding,
  ): Promise<ResolvedElevationCommand> {
    const executablePath = await realpath(await resolveExecutable(recipe.command.executable));
    const executableHash = `sha256:${createHash('sha256')
      .update(await readFile(executablePath))
      .digest('hex')}`;
    const cwd = await realpath(path.resolve(binding.workspaceRoot, recipe.command.cwd));
    const workspaceRoot = await realpath(binding.workspaceRoot);
    if (cwd !== workspaceRoot && !cwd.startsWith(`${workspaceRoot}${path.sep}`))
      throw new Error('Elevation cwd escaped the workspace binding');
    return { cwd, executableHash, executablePath, workspaceRoot };
  }

  private unsignedEnvelope(
    recipe: ElevationRecipe,
    binding: ElevationBinding,
    command: ResolvedElevationCommand,
    now: number,
  ): Omit<ElevationEnvelope, 'signature'> {
    return {
      schemaVersion: '1',
      requestId: `elevation:${randomUUID()}`,
      nonce: randomBytes(32).toString('base64url'),
      runId: binding.runId,
      workspaceId: binding.workspaceId,
      targetId: binding.targetId,
      parentPid: binding.parentPid,
      executablePath: command.executablePath,
      executableHash: command.executableHash,
      arguments: recipe.command.arguments,
      argumentsHash: elevationDigest(recipe.command.arguments),
      cwd: command.cwd,
      cwdHash: elevationDigest(command.cwd),
      environmentHash: elevationDigest(recipe.command.environment),
      timeoutMs: recipe.command.timeoutMs,
      recipeId: recipe.recipeId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    };
  }

  private assertMatchingReceipt(
    receipt: ElevationReceipt,
    envelope: ElevationEnvelope,
    helper: ElevationHelperIdentity,
  ): void {
    if (
      receipt.requestId !== envelope.requestId ||
      receipt.nonce !== envelope.nonce ||
      receipt.executableHash !== envelope.executableHash ||
      receipt.argumentsHash !== envelope.argumentsHash ||
      receipt.targetId !== envelope.targetId ||
      receipt.helperIdentity !== helper.identity
    ) {
      throw new Error('Elevation helper receipt does not match the approved operation');
    }
  }

  private async assertSuccessfulReceipt(receipt: ElevationReceipt): Promise<void> {
    if (!(await this.native.verifyReceipt(receipt)))
      throw new Error('Elevation receipt signature is invalid');
    if (receipt.status !== 'succeeded' || receipt.exitCode !== 0)
      throw new Error(`Elevated operation did not succeed: ${receipt.status}`);
  }

  private async verifyOutcome(
    recipe: ElevationRecipe,
    workspaceRoot: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const verification = await this.verification.execute(recipe, workspaceRoot, signal);
    if (verification.exitCode !== 0 || verification.timedOut || verification.cancelled)
      throw new Error('Elevated operation completed but post-operation verification failed');
  }
}
