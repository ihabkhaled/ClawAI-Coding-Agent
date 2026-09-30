import type { AgentMcpOptions } from '../sdk/mcp-toolkit.types';

/** The files a run reads before it starts, or the first reason one could not be used. */
export type HeadlessInputs =
  | {
      readonly ok: true;
      readonly systemPrompt?: string;
      readonly mcp?: AgentMcpOptions;
    }
  | { readonly ok: false; readonly message: string };
