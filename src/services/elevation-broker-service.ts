import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';

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
}

export class ElevationBrokerService {
  private readonly replay = new ElevationReplayGuard();

  constructor(
    private readonly native: NativeElevationPort,
    private readonly consent: ElevationConsentPort,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(
    candidate: unknown,
    binding: ElevationBinding,
    signal?: AbortSignal,
  ): Promise<ElevationReceipt> {
    const recipe = elevationRecipeSchema.parse(candidate);
    if (!this.native.interactive)
      throw new Error('Elevation requires an interactive native target');
    const helper = await this.native.helperIdentity();
    if (!helper.trusted)
      throw new Error('The native elevation helper is missing or its signature is invalid');
    if (!(await this.consent.confirm(recipe, signal)))
      throw new Error('Elevation was not approved');
    signal?.throwIfAborted();
    const executablePath = await realpath(await resolveExecutable(recipe.command.executable));
    const executableHash = `sha256:${createHash('sha256')
      .update(await readFile(executablePath))
      .digest('hex')}`;
    const now = this.now();
    const unsigned: Omit<ElevationEnvelope, 'signature'> = {
      schemaVersion: '1',
      requestId: `elevation:${randomUUID()}`,
      nonce: randomBytes(32).toString('base64url'),
      runId: binding.runId,
      workspaceId: binding.workspaceId,
      targetId: binding.targetId,
      parentPid: binding.parentPid,
      executablePath,
      executableHash,
      arguments: recipe.command.arguments,
      argumentsHash: elevationDigest(recipe.command.arguments),
      cwd: recipe.command.cwd,
      cwdHash: elevationDigest(recipe.command.cwd),
      environmentHash: elevationDigest(recipe.command.environment),
      recipeId: recipe.recipeId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    };
    const envelope = { ...unsigned, signature: await this.native.signRequest(unsigned) };
    this.replay.consume(envelope.nonce, envelope.expiresAt, now);
    const receipt = elevationReceiptSchema.parse(await this.native.execute(envelope, signal));
    if (
      receipt.requestId !== envelope.requestId ||
      receipt.nonce !== envelope.nonce ||
      receipt.executableHash !== envelope.executableHash ||
      receipt.argumentsHash !== envelope.argumentsHash ||
      receipt.targetId !== envelope.targetId
    ) {
      throw new Error('Elevation helper receipt does not match the approved operation');
    }
    if (!(await this.native.verifyReceipt(receipt)))
      throw new Error('Elevation receipt signature is invalid');
    return receipt;
  }
}
