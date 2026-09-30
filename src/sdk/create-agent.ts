import { headlessExitCode, outcomeFromError } from '../core/headless-outcome';
import { redactText } from '../core/redaction';
import { HeadlessTransport } from '../headless/headless-transport';

import { agentEventFrom } from './agent-events';
import { assertAgentInputs, promptWithInstructions, withoutInstructions } from './agent-inputs';
import { runAgent } from './agent-sdk';
import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { agentToolkit } from './agent-toolkit';
import { observedToolkit } from './observed-toolkit';

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
 * a bounded command, read-only git, and MCP servers when configured — execute
 * on this machine, and only within `permissions`.
 *
 * The agent is one conversation: the first run's thread (or the `threadId`
 * given) is reused by every later run, and is readable as `agent.threadId`.
 */
export function createAgent(config: AgentConfig): Agent {
  assertAgentInputs(config);
  const session: { threadId: string | undefined } = { threadId: config.threadId };
  return {
    get threadId() {
      return session.threadId;
    },
    run: (prompt, options = {}) => runOnce(config, session, prompt, options),
  };
}

async function runOnce(
  config: AgentConfig,
  session: { threadId: string | undefined },
  prompt: string,
  options: AgentRunCallOptions,
): Promise<AgentResult> {
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const tally = { denied: 0, text: '', signingIn: true, runId: '' };
  const transport =
    config.transport ?? new HeadlessTransport(config.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl);
  const inner = agentToolkit(config);
  const toolkit = observedToolkit(inner, emit, tally);
  try {
    // Signed in here rather than inside runAgent, so a refusal can be told
    // apart from a later one: during sign-in any client error is the credential.
    const token = 'token' in config.auth ? config.auth.token : await transport.signIn(config.auth);
    tally.signingIn = false;
    const report = await runAgent({
      prompt: promptWithInstructions(prompt, config.systemPrompt),
      toolkit,
      token,
      provider: config.provider,
      model: config.model,
      title: options.title,
      threadId: session.threadId,
      deadlineMs: config.deadlineMs,
      transport,
      signal: options.signal,
      ...(options.maxTurns === undefined
        ? {}
        : { budget: { maxModelTurns: options.maxTurns, maxToolRounds: options.maxTurns } }),
      onStarted: (run) => {
        tally.runId = run.runId;
        session.threadId = run.threadId;
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
      ...(session.threadId === undefined ? {} : { threadId: session.threadId }),
      error: redacted(error instanceof Error ? error.message : 'Agent run failed', config),
    });
  } finally {
    inner.dispose?.();
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

/** An error message with the credential and the operator instructions removed. */
function redacted(message: string, config: AgentConfig): string {
  const secret = 'token' in config.auth ? config.auth.token : config.auth.password;
  const withoutSecret = secret.length === 0 ? message : message.split(secret).join('[redacted]');
  return redactText(withoutInstructions(withoutSecret, config.systemPrompt));
}
