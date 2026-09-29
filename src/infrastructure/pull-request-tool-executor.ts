import { z } from 'zod';

import { CONVENTIONAL_TYPES } from '../core/pull-request.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { PullRequestService } from '../services/pull-request-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const rootKey = z.string().trim().min(1).max(100);

const requestSchema = z
  .object({
    rootKey,
    baseBranch: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    summary: z.string().trim().min(1).max(10_000).optional(),
    type: z.enum(CONVENTIONAL_TYPES).optional(),
    draft: z.boolean().optional(),
  })
  .strip();

const numberSchema = z.object({ rootKey, number: z.number().int().min(1).max(10_000_000) }).strip();

export const pullRequestToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.pull-request',
  version: '2.0.0',
  description:
    'Open and follow a GitHub pull request for the current branch through the signed-in gh CLI. ' +
    'draft takes rootKey and optional baseBranch, title, summary and type, and returns a ' +
    'Conventional Commits title, a description and a commitMessage to use for anything still ' +
    'uncommitted, plus the readiness blockers. publish opens the pull request after the person ' +
    'approves the exact title and description, pushing the branch first when that is all that ' +
    'is missing, and returns its url; its checks are then watched. fetch-checks and ' +
    'fetch-failure-logs take rootKey and number and return the check states and the failed-job ' +
    'logs. Commit your work with workspace.git before publishing.',
  operations: ['draft', 'publish', 'fetch-checks', 'fetch-failure-logs'],
  riskClasses: ['inspect', 'network', 'publish'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.pullRequest,
};

/**
 * The model's door to pull requests: draft, publish, and the checks after.
 *
 * `publish` is classified as publication by its name, so the runtime policy
 * asks before it runs; the service then shows the exact title and description
 * for a second, specific approval. Two approvals is deliberate — the first is
 * "may the agent publish at all", the second is "this text, on this branch".
 */
export class PullRequestToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly pullRequests: PullRequestService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== pullRequestToolDefinition.name) {
      throw new Error('Unknown pull request tool');
    }
    switch (invocation.operation) {
      case 'draft':
        return {
          structured: {
            ...(await this.pullRequests.draft(requestSchema.parse(invocation.arguments), signal)),
          },
        };
      case 'publish':
        return {
          structured: {
            ...(await this.pullRequests.publish(requestSchema.parse(invocation.arguments), signal)),
          },
        };
      case 'fetch-checks': {
        const { rootKey: key, number } = numberSchema.parse(invocation.arguments);
        return { structured: { ...(await this.pullRequests.checks(key, number, signal)) } };
      }
      case 'fetch-failure-logs': {
        const { rootKey: key, number } = numberSchema.parse(invocation.arguments);
        return { structured: { ...(await this.pullRequests.failureLogs(key, number, signal)) } };
      }
      default:
        throw new Error('Unknown pull request operation');
    }
  }
}
