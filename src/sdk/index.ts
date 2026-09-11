/**
 * The public surface of the agent SDK.
 *
 * One module, so what is supported is a list a reader can hold in their head
 * rather than whatever happens to be exported from somewhere inside. Anything
 * not here is an implementation detail and may move.
 */
export { runAgent } from './agent-sdk';
export { toolResultFor } from './agent-tool-result';
export { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
export { HeadlessTransport, canonicalJson, sha256 } from '../headless/headless-transport';
export {
  describeHeadlessOutcome,
  headlessExitCode,
  outcomeFromTerminalEvent,
} from '../core/headless-outcome';
export { HEADLESS_EXIT_CODES } from '../core/headless-outcome.constants';
export { containedPath } from '../core/workspace-containment';
export { inheritedEnvironment } from '../core/inherited-environment';

export type {
  AgentRunOptions,
  AgentRunResult,
  AgentToolCall,
  AgentToolkit,
  RuntimeTransportPort,
} from './agent-sdk.types';
export type { HeadlessExitCode, HeadlessOutcome } from '../core/headless-outcome.types';
export type { HeadlessStreamEvent } from '../headless/headless-session.types';
