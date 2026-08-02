import { z } from 'zod';

const integrationRequestSchema = z
  .object({
    integrationId: z.string().min(8).max(200),
    targetWorktreeId: z.string().min(3).max(200),
    commits: z
      .array(
        z
          .object({
            taskId: z.string().min(2).max(100),
            worktreeId: z.string().min(3).max(200),
            commit: z.string().regex(/^[a-f0-9]{7,64}$/u),
            changedPaths: z.array(z.string().min(1).max(4_096)).max(10_000),
            integrationSeams: z.array(z.string().min(1).max(1_000)).max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
    mandatoryGateIds: z.array(z.string().min(3).max(200)).min(1).max(1_000),
  })
  .strict();

export interface IntegrationGitPort {
  workingFingerprint(worktreeId: string): Promise<string>;
  cherryPick(
    worktreeId: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<{ readonly conflicts: readonly string[] }>;
  abortCherryPick(worktreeId: string): Promise<void>;
}

export interface IntegrationQualityPort {
  run(
    worktreeId: string,
    gateIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly { readonly gateId: string; readonly passed: boolean }[]>;
}

export interface IntegrationReceipt {
  readonly integrationId: string;
  readonly status: 'integrated' | 'conflict' | 'gates-failed';
  readonly integratedCommits: readonly string[];
  readonly conflicts: readonly string[];
  readonly semanticConflicts: readonly string[];
  readonly gates: readonly { readonly gateId: string; readonly passed: boolean }[];
}

export class IntegrationCoordinatorService {
  constructor(
    private readonly git: IntegrationGitPort,
    private readonly quality: IntegrationQualityPort,
  ) {}

  async integrate(candidate: unknown, signal?: AbortSignal): Promise<IntegrationReceipt> {
    const request = integrationRequestSchema.parse(candidate);
    const initialFingerprint = await this.git.workingFingerprint(request.targetWorktreeId);
    const integrated: string[] = [];
    const semanticConflicts = this.semanticConflicts(request.commits);
    if (semanticConflicts.length > 0) {
      return {
        integrationId: request.integrationId,
        status: 'conflict',
        integratedCommits: [],
        conflicts: [],
        semanticConflicts,
        gates: [],
      };
    }
    for (const item of request.commits) {
      signal?.throwIfAborted();
      const before = await this.git.workingFingerprint(request.targetWorktreeId);
      if (before !== initialFingerprint && integrated.length === 0) {
        throw new Error('Target worktree changed after integration review');
      }
      const result = await this.git.cherryPick(request.targetWorktreeId, item.commit, signal);
      if (result.conflicts.length > 0) {
        await this.git.abortCherryPick(request.targetWorktreeId);
        return {
          integrationId: request.integrationId,
          status: 'conflict',
          integratedCommits: integrated,
          conflicts: result.conflicts,
          semanticConflicts: [],
          gates: [],
        };
      }
      integrated.push(item.commit);
    }
    const gates = await this.quality.run(
      request.targetWorktreeId,
      request.mandatoryGateIds,
      signal,
    );
    return {
      integrationId: request.integrationId,
      status: gates.every(({ passed }) => passed) ? 'integrated' : 'gates-failed',
      integratedCommits: integrated,
      conflicts: [],
      semanticConflicts: [],
      gates,
    };
  }

  private semanticConflicts(
    commits: z.infer<typeof integrationRequestSchema>['commits'],
  ): string[] {
    const conflicts: string[] = [];
    const record = (
      values: readonly string[],
      taskId: string,
      owners: Map<string, string>,
    ): void => {
      for (const value of values) {
        const owner = owners.get(value);
        if (owner !== undefined) conflicts.push(`${value}: ${owner} and ${taskId}`);
        owners.set(value, taskId);
      }
    };
    const paths = new Map<string, string>();
    const seams = new Map<string, string>();
    for (const item of commits) {
      record(item.changedPaths, item.taskId, paths);
      record(item.integrationSeams, item.taskId, seams);
    }
    return conflicts;
  }
}
