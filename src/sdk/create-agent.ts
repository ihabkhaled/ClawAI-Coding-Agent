import { headlessExitCode, outcomeFromError } from '../core/headless-outcome';
import { HeadlessTransport } from '../headless/headless-transport';

import { agentEventFrom } from './agent-events';
import { runAgent } from './agent-sdk';
import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { workspaceToolkit } from './workspace-toolkit';
import { AGENT_DEFAULT_TOOL_CATEGORIES } from './workspace-toolkit.constants';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentRunCallOptions,
} from './create-agent.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

/**
 * A host-free agent bound to one workspace and one identity.
 *
 * `run` never throws for a run that went wrong: it resolves with an outcome and
 * the exit code the headless contract promises for it, so a caller can branch
 * on a value instead of guessing what an exception meant. Local tools — files,
 * a bounded command, read-only git — execute on this machine inside
 * `workspaceRoot`, and only within `permissions`.
 */
export function createAgent(config: AgentConfig): Agent {
  return { run: (prompt, options = {}) => runOnce(config, prompt, options) };
}

async function runOnce(
  config: AgentConfig,
  prompt: string,
  options: AgentRunCallOptions,
): Promise<AgentResult> {
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const tally = { denied: 0, text: '', signingIn: true, runId: '' };
  const transport =
    config.transport ?? new HeadlessTransport(config.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl);
  const toolkit = observedToolkit(
    workspaceToolkit(
      config.workspaceRoot,
      config.permissions ?? { allow: AGENT_DEFAULT_TOOL_CATEGORIES },
    ),
    emit,
    tally,
  );
  try {
    // Signed in here rather than inside runAgent, so a refusal can be told
    // apart from a later one: during sign-in any client error is the credential.
    const token = 'token' in config.auth ? config.auth.token : await transport.signIn(config.auth);
    tally.signingIn = false;
    const report = await runAgent({
      prompt,
      toolkit,
      token,
      provider: config.provider,
      model: config.model,
      title: options.title,
      deadlineMs: config.deadlineMs,
      transport,
      signal: options.signal,
      ...(options.maxTurns === undefined
        ? {}
        : { budget: { maxModelTurns: options.maxTurns, maxToolRounds: options.maxTurns } }),
      onStarted: (run) => {
        tally.runId = run.runId;
        emit({ type: 'run.started', ...run });
      },
      onEvent: (raw) => {
        const event = agentEventFrom(raw);
        if (event?.type === 'text') tally.text += event.text;
        if (event !== undefined) emit(event);
      },
    });
    const outcome = withDenials(report.outcome, tally.denied);
    return finish(emit, {
      ...report,
      outcome,
      exitCode: headlessExitCode(outcome),
      deniedCalls: tally.denied,
      text: tally.text,
    });
  } catch (error) {
    const outcome = outcomeFromError(error, {
      aborted: options.signal?.aborted === true,
      signingIn: tally.signingIn,
    });
    return finish(emit, {
      outcome,
      exitCode: headlessExitCode(outcome),
      toolCalls: 0,
      deniedCalls: tally.denied,
      text: tally.text,
      ...(tally.runId.length === 0 ? {} : { runId: tally.runId }),
      error: redacted(error instanceof Error ? error.message : 'Agent run failed', config),
    });
  }
}

function finish(emit: (event: AgentEvent) => void, result: AgentResult): AgentResult {
  emit({ type: 'run.finished', result });
  return result;
}

/**
 * A run that failed after a tool was refused failed because of the refusal, and
 * the remedy is a permission, not a retry — so it is reported as blocked.
 */
function withDenials(outcome: HeadlessOutcome, denied: number): HeadlessOutcome {
  return outcome === 'failed' && denied > 0 ? 'blocked' : outcome;
}

/** Wraps a toolkit so every decision and every result becomes an event. */
function observedToolkit(
  inner: AgentToolkit,
  emit: (event: AgentEvent) => void,
  tally: { denied: number },
): AgentToolkit {
  const label = (call: AgentToolCall): { toolName: string; operation: string } => ({
    toolName: call.toolName,
    operation: call.operation,
  });
  return {
    definitions: inner.definitions,
    authorize: async (call) => {
      const allowed = inner.authorize === undefined ? true : await inner.authorize(call);
      if (!allowed) tally.denied += 1;
      emit(allowed ? { type: 'tool.call', ...call } : { type: 'tool.denied', ...label(call) });
      return allowed;
    },
    execute: (call) => {
      try {
        const result = inner.execute(call);
        emit({ type: 'tool.result', ...label(call), ok: true });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool failed';
        emit({ type: 'tool.result', ...label(call), ok: false, message });
        throw error;
      }
    },
  };
}

/** An error message with the configured secret removed, in case a server echoed it. */
function redacted(message: string, config: AgentConfig): string {
  const secret = 'token' in config.auth ? config.auth.token : config.auth.password;
  return secret.length === 0 ? message : message.split(secret).join('[redacted]');
}
