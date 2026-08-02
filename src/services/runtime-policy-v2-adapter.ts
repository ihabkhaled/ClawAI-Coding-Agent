import { createHash, randomBytes } from 'node:crypto';

import { evaluatePolicyV2, OneShotCapabilityIssuer, type PolicyRequest } from '../core/policy-v2';

import type { RuntimeToolPolicyDecision, RuntimeToolPolicyPort } from './runtime-tool-dispatcher';
import type { PermissionMode } from '../core/permission-policy.types';
import type { ProjectPolicy } from '../core/policy-v2';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

interface RuntimePolicyContext {
  readonly accountId: () => string;
  readonly backendOrigin: () => string;
  readonly workspaceId: () => string;
  readonly workspaceRoot: () => string;
  readonly mode: () => PermissionMode;
  readonly workspaceTrusted: () => boolean;
  readonly userPresent: () => boolean;
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

function classify(
  invocation: ToolInvocation,
): Pick<PolicyRequest, 'effect' | 'risk' | 'reversible'> {
  const operation = `${invocation.toolName}.${invocation.operation}`.toLowerCase();
  if (invocation.toolName === 'runtime.elevation')
    return { effect: 'elevation', risk: 'R4', reversible: false };
  if (invocation.toolName === 'runtime.integration' || invocation.toolName === 'runtime.flagship')
    return { effect: 'local-mutation', risk: 'R3', reversible: false };
  if (invocation.toolName === 'workspace.git') return classifyGit(invocation.operation);
  if (invocation.toolName === 'workspace.files') return classifyFiles(invocation.operation);
  return classifyOperation(invocation, operation);
}

type Classification = Pick<PolicyRequest, 'effect' | 'risk' | 'reversible'>;

const gitReadOperations = new Set([
  'status',
  'diff',
  'log',
  'blame',
  'branches',
  'tags',
  'remotes',
  'worktrees',
  'conflicts',
  'submodules',
  'topology',
]);

function classifyGit(operation: string): Classification {
  if (operation === 'push' || operation === 'tag') {
    return { effect: 'publication', risk: 'R3', reversible: false };
  }
  if (operation === 'fetch') return { effect: 'read', risk: 'R2', reversible: true };
  if (gitReadOperations.has(operation)) return { effect: 'read', risk: 'R0', reversible: true };
  return { effect: 'local-mutation', risk: 'R3', reversible: false };
}

const fileWriteOperations = new Set([
  'create',
  'update',
  'patch',
  'rename',
  'copy',
  'mkdir',
  'artifact',
]);

function classifyFiles(operation: string): Classification {
  if (operation === 'delete') return { effect: 'destructive', risk: 'R4', reversible: false };
  if (fileWriteOperations.has(operation)) {
    return { effect: 'workspace-write', risk: 'R1', reversible: true };
  }
  return { effect: 'read', risk: 'R0', reversible: true };
}

const operationRules: readonly (readonly [RegExp, Classification])[] = [
  [/elevat|admin|sudo|root/u, { effect: 'elevation', risk: 'R4', reversible: false }],
  [/production|prod\b/u, { effect: 'production', risk: 'R4', reversible: false }],
  [
    /delete|destroy|drop|prune|reset|force/u,
    { effect: 'destructive', risk: 'R4', reversible: false },
  ],
  [/publish|push|release|deploy/u, { effect: 'publication', risk: 'R3', reversible: false }],
  [/network-write|http-post|webhook/u, { effect: 'network-write', risk: 'R3', reversible: false }],
  [/fetch|crawl|search/u, { effect: 'read', risk: 'R2', reversible: true }],
  [
    /write|edit|patch|create|rename|move|export|save|persist/u,
    { effect: 'workspace-write', risk: 'R1', reversible: true },
  ],
  [
    /run|exec|process|container|database/u,
    { effect: 'local-mutation', risk: 'R2', reversible: false },
  ],
];

function classifyOperation(invocation: ToolInvocation, operation: string): Classification {
  if (
    invocation.toolName === 'workspace.browser' &&
    /^(?:click|fill|select|keyboard|drag|upload|download)$/u.test(invocation.operation)
  ) {
    return { effect: 'network-write', risk: 'R3', reversible: false };
  }
  return (
    operationRules.find(([pattern]) => pattern.test(operation))?.[1] ?? {
      effect: 'read',
      risk: 'R0',
      reversible: true,
    }
  );
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
      mode: mode(this.context.mode()),
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
    };
    const decision = evaluatePolicyV2(request, await this.projectPolicy.load());
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

  consumeCapability(invocation: ToolInvocation): void {
    const token = this.capabilities.get(invocation.invocationId);
    if (token === undefined) return;
    const classification = classify(invocation);
    const request: PolicyRequest = {
      runId: invocation.runId,
      invocationHash: `sha256:${createHash('sha256').update(JSON.stringify(invocation)).digest('hex')}`,
      mode: mode(this.context.mode()),
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
    };
    this.issuer.consume(token, request);
    this.capabilities.delete(invocation.invocationId);
  }
}
