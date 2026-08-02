import { createHash, randomBytes } from 'node:crypto';

import { evaluatePolicyV2, OneShotCapabilityIssuer, type PolicyRequest } from '../core/policy-v2';

import type { ProjectPolicyService } from './project-policy-service';
import type { RuntimeToolPolicyDecision, RuntimeToolPolicyPort } from './runtime-tool-dispatcher';
import type { PermissionMode } from '../core/permission-policy.types';
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
  if (/elevat|admin|sudo|root/u.test(operation))
    return { effect: 'elevation', risk: 'R4', reversible: false };
  if (/production|prod\b/u.test(operation))
    return { effect: 'production', risk: 'R4', reversible: false };
  if (/delete|destroy|drop|prune|reset|force/u.test(operation))
    return { effect: 'destructive', risk: 'R4', reversible: false };
  if (/publish|push|release|deploy/u.test(operation))
    return { effect: 'publication', risk: 'R3', reversible: false };
  if (/network-write|http-post|webhook/u.test(operation))
    return { effect: 'network-write', risk: 'R3', reversible: false };
  if (
    invocation.toolName === 'workspace.browser' &&
    /^(?:click|fill|select|keyboard|drag|upload|download)$/u.test(invocation.operation)
  )
    return { effect: 'network-write', risk: 'R3', reversible: false };
  if (/fetch|crawl|search/u.test(operation))
    return { effect: 'read', risk: 'R2', reversible: true };
  if (/write|edit|patch|create|rename|move|export|save|persist/u.test(operation))
    return { effect: 'workspace-write', risk: 'R1', reversible: true };
  if (/run|exec|process|container|database/u.test(operation))
    return { effect: 'local-mutation', risk: 'R2', reversible: false };
  return { effect: 'read', risk: 'R0', reversible: true };
}

export class RuntimePolicyV2Adapter implements RuntimeToolPolicyPort {
  private readonly capabilities = new Map<string, string>();
  private readonly issuer = new OneShotCapabilityIssuer(randomBytes(32));

  constructor(
    private readonly context: RuntimePolicyContext,
    private readonly projectPolicy: ProjectPolicyService,
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
