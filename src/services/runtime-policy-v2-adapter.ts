import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { mcpPolicySubject } from '../core/mcp/mcp-policy-classification';
import { MCP_TOOL_NAME } from '../core/mcp/mcp.constants';
import {
  clampToOrganizationFloor,
  organizationCeilingOf,
} from '../core/organization-permission-floor';
import {
  evaluatePolicyV2,
  OneShotCapabilityIssuer,
  type PolicyRequest,
  type PolicySubject,
} from '../core/policy-v2';
import {
  classifiedOperation,
  UNCLASSIFIED_OPERATION,
} from '../core/runtime/runtime-operation-classification';

import type { RuntimeToolPolicyDecision, RuntimeToolPolicyPort } from './runtime-tool-dispatcher';
import type { PermissionMode } from '../core/permission-policy.types';
import type { ProjectPolicy } from '../core/policy-v2';
import type { OperationClassification } from '../core/runtime/runtime-operation-classification';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

interface RuntimePolicyContext {
  readonly accountId: () => string;
  readonly backendOrigin: () => string;
  readonly workspaceId: () => string;
  readonly workspaceRoot: () => string;
  readonly mode: () => PermissionMode;
  readonly workspaceTrusted: () => boolean;
  readonly userPresent: () => boolean;
  /** Undefined when no organization constrains this user, or the backend is older. */
  readonly organizationPolicy: () => unknown;
  /** The workspace repository as `host/owner/name`, for organization trust lists. */
  readonly repository?: () => string | undefined;
  readonly approve: (request: PolicyRequest, signal?: AbortSignal) => Promise<boolean>;
}

export interface RuntimeProjectPolicyPort {
  load(): Promise<ProjectPolicy>;
}

const mode = (value: PermissionMode): PolicyRequest['mode'] => {
  if (value === 'PLAN') return 'PLAN';
  if (value === 'AUTO_EDIT' || value === 'EDIT_AUTOMATICALLY') return 'AUTO_EDIT';
  if (value === 'AUTONOMOUS_SCOPED' || value === 'BYPASS_PERMISSIONS') return 'AUTONOMOUS_SCOPED';
  if (value === 'ENTERPRISE_LOCKED') return 'ENTERPRISE_LOCKED';
  return 'ASK';
};

/**
 * The risk class and effect of one invocation, from the explicit table in
 * `runtime-operation-classification.ts`. An operation missing from it is an
 * irreversible local mutation that always asks, never a quiet read.
 */
export function classify(invocation: ToolInvocation): OperationClassification {
  return classifiedOperation(invocation.toolName, invocation.operation) ?? UNCLASSIFIED_OPERATION;
}

/**
 * What a project rule may match on: the tool, the operation, the paths the
 * call names and the command it would run.
 *
 * Paths are collected from the argument shapes the tools actually use rather
 * than by walking the whole object, so a rule matches what the call will touch
 * and not an unrelated string that happens to look like a path.
 */
// The argument shapes that name a path. Parsing them beats walking the object:
// a rule then matches what the call will touch, not an unrelated string that
// happens to look like a path, and nothing is read off an `any`.
const pathBearingArgumentsSchema = z
  .object({
    path: z.string().min(1).max(4_096).optional(),
    paths: z.array(z.string().min(1).max(4_096)).max(1_000).optional(),
    transaction: z
      .object({
        operations: z
          .array(
            z
              .object({
                path: z.string().min(1).max(4_096).optional(),
                destination: z.string().min(1).max(4_096).optional(),
              })
              .loose(),
          )
          .max(1_000)
          .optional(),
      })
      .loose()
      .optional(),
    executable: z.string().min(1).max(4_096).optional(),
    arguments: z.array(z.string().max(32_768)).max(1_000).optional(),
    url: z.string().min(1).max(4_096).optional(),
  })
  .loose();

/**
 * The hosts a call names, for domain rules to match against.
 *
 * Parsed with the URL parser rather than a pattern, so `https://evil.test/#a.trusted.test`
 * yields `evil.test` and not the host someone hoped a reader would see. A URL
 * that does not parse contributes nothing: the tool's own guard is what
 * rejects it, and inventing a host here would be inventing a policy subject.
 */
function subjectDomains(parsed: z.infer<typeof pathBearingArgumentsSchema>): string[] {
  if (parsed.url === undefined) return [];
  try {
    return [new URL(parsed.url).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

function subjectPaths(parsed: z.infer<typeof pathBearingArgumentsSchema>): string[] {
  const paths = new Set<string>();
  if (parsed.path !== undefined) paths.add(parsed.path);
  for (const value of parsed.paths ?? []) paths.add(value);
  for (const operation of parsed.transaction?.operations ?? []) {
    if (operation.path !== undefined) paths.add(operation.path);
    if (operation.destination !== undefined) paths.add(operation.destination);
  }
  return [...paths];
}

/**
 * What a project rule may match on: the tool, the operation, the paths the
 * call names and the command it would run.
 *
 * Malformed arguments yield a subject with no paths rather than throwing. The
 * tool's own schema is what rejects them; refusing to classify here would turn
 * a bad argument into a policy failure.
 */
function policySubject(invocation: ToolInvocation): PolicySubject {
  if (invocation.toolName === MCP_TOOL_NAME) {
    return mcpPolicySubject(invocation.operation, invocation.toolName, invocation.arguments);
  }
  const parsed = pathBearingArgumentsSchema.safeParse(invocation.arguments);
  const base = { tool: invocation.toolName, operation: invocation.operation };
  if (!parsed.success) return { ...base, paths: [], domains: [] };
  const command =
    parsed.data.executable === undefined
      ? undefined
      : [parsed.data.executable, ...(parsed.data.arguments ?? [])].join(' ').slice(0, 8_192);
  return {
    ...base,
    paths: subjectPaths(parsed.data),
    domains: subjectDomains(parsed.data),
    ...(command === undefined ? {} : { command }),
  };
}

export class RuntimePolicyV2Adapter implements RuntimeToolPolicyPort {
  private readonly capabilities = new Map<string, string>();
  private readonly issuer = new OneShotCapabilityIssuer(randomBytes(32));

  constructor(
    private readonly context: RuntimePolicyContext,
    private readonly projectPolicy: RuntimeProjectPolicyPort,
  ) {}

  async evaluate(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolPolicyDecision> {
    signal?.throwIfAborted();
    const classification = classify(invocation);
    const request: PolicyRequest = {
      runId: invocation.runId,
      invocationHash: `sha256:${createHash('sha256').update(JSON.stringify(invocation)).digest('hex')}`,
      mode: this.effectiveMode(),
      ...classification,
      scope: {
        accountId: this.context.accountId(),
        backendOrigin: this.context.backendOrigin(),
        workspaceId: this.context.workspaceId(),
        targetId: invocation.targetId,
        root: this.context.workspaceRoot(),
      },
      workspaceTrusted: this.context.workspaceTrusted(),
      userPresent: this.context.userPresent(),
      subject: this.subject(invocation),
    };
    const decision = evaluatePolicyV2(
      request,
      await this.projectPolicy.load(),
      this.context.organizationPolicy(),
    );
    if (decision.outcome === 'deny') {
      return {
        decision: 'deny',
        code: decision.code,
        message: 'Runtime policy denied this effect.',
      };
    }
    if (decision.outcome === 'ask' && !(await this.context.approve(request, signal))) {
      return { decision: 'deny', code: 'USER_DENIED', message: 'The user denied this effect.' };
    }
    signal?.throwIfAborted();
    if (decision.outcome === 'ask') {
      this.capabilities.set(invocation.invocationId, this.issuer.issue(request, 120_000));
    }
    return {
      decision: 'allow',
      code: decision.code,
      message: 'Runtime policy allowed this effect.',
    };
  }

  private subject(invocation: ToolInvocation): PolicySubject {
    const repository = this.context.repository?.();
    const subject = policySubject(invocation);
    return repository === undefined ? subject : { ...subject, repository };
  }

  /**
   * The configured mode, held under the organization's ceiling (ADR 0003).
   *
   * Clamped here as well as at selection: a mode written straight into
   * settings.json, or chosen before the organization tightened its policy,
   * never reaches the evaluator above the ceiling.
   */
  private effectiveMode(): PolicyRequest['mode'] {
    return mode(
      clampToOrganizationFloor(
        this.context.mode(),
        organizationCeilingOf(this.context.organizationPolicy()),
      ),
    );
  }

  consumeCapability(invocation: ToolInvocation): void {
    const token = this.capabilities.get(invocation.invocationId);
    if (token === undefined) return;
    const classification = classify(invocation);
    const request: PolicyRequest = {
      runId: invocation.runId,
      invocationHash: `sha256:${createHash('sha256').update(JSON.stringify(invocation)).digest('hex')}`,
      mode: this.effectiveMode(),
      ...classification,
      scope: {
        accountId: this.context.accountId(),
        backendOrigin: this.context.backendOrigin(),
        workspaceId: this.context.workspaceId(),
        targetId: invocation.targetId,
        root: this.context.workspaceRoot(),
      },
      workspaceTrusted: this.context.workspaceTrusted(),
      userPresent: this.context.userPresent(),
      subject: this.subject(invocation),
    };
    this.issuer.consume(token, request);
    this.capabilities.delete(invocation.invocationId);
  }
}
