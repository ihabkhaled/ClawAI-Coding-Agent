import { approvalFrom } from './headless-approval';
import { withMcpTokens } from './mcp/mcp-login-service';

import type { HeadlessEnvironment, HeadlessInvocation, HeadlessIo } from './headless-args.types';
import type { HeadlessInputs } from './headless-inputs.types';
import type { RuntimeTransportPort } from '../sdk/agent-sdk.types';
import type { AgentAuth, AgentConfig } from '../sdk/create-agent.types';

/** What one invocation asks of the SDK: identity, grants, files already read, MCP tokens. */
export function agentConfigFor(input: {
  readonly invocation: HeadlessInvocation;
  readonly inputs: Extract<HeadlessInputs, { ok: true }>;
  readonly auth: AgentAuth;
  readonly threadId: string | undefined;
  readonly environment: HeadlessEnvironment;
  readonly io: HeadlessIo;
  readonly transport: RuntimeTransportPort | undefined;
}): AgentConfig {
  const { invocation, inputs } = input;
  return {
    auth: input.auth,
    workspaceRoot: invocation.workspace,
    backendUrl: invocation.backendUrl,
    model: invocation.model,
    provider: invocation.provider,
    permissions: {
      allow: invocation.allowTools,
      allowedExecutables: invocation.allowCommands,
      ...(invocation.allowShell === true ? { shell: { deny: invocation.shellDeny } } : {}),
      writeScope: invocation.writeScope,
      writeDeny: invocation.writeDeny,
      httpAllowHosts: invocation.httpAllowHosts,
      ...(invocation.permissionMode === undefined ? {} : { approve: approvalFrom(input.io) }),
    },
    permissionMode: invocation.permissionMode,
    allowedTools: invocation.allowedTools,
    disallowedTools: invocation.disallowedTools,
    effort: invocation.effort,
    speed: invocation.speed,
    context: invocation.context,
    research: invocation.research,
    browser:
      invocation.browserAllowHosts === undefined
        ? undefined
        : { allowHosts: invocation.browserAllowHosts },
    loadKnowledge: invocation.loadKnowledge,
    ...(invocation.images === undefined ? {} : { images: invocation.images }),
    ...(invocation.vision === true ? { vision: { model: invocation.visionModel } } : {}),
    maxAgents: invocation.maxAgents,
    toolsProfile: invocation.toolsProfile,
    deferTools: invocation.deferTools,
    threadId: input.threadId,
    useMemory: invocation.useMemory,
    systemPrompt: inputs.systemPrompt,
    doneChecks: inputs.doneChecks,
    planSteps: inputs.planSteps,
    requirePlan: invocation.requirePlan,
    taskPlan: invocation.taskPlan,
    mcp:
      inputs.mcp === undefined
        ? undefined
        : withMcpTokens(inputs.mcp, invocation, input.environment),
    transport: input.transport,
  };
}
