import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

export type HeadlessOutputFormat = 'text' | 'json' | 'stream-json';

/** Everything an invocation decided, before any network call. */
export interface HeadlessInvocation {
  readonly prompt: string;
  readonly workspace: string;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly backendUrl?: string | undefined;
  readonly allowTools: readonly AgentToolCategory[];
  readonly allowCommands: readonly string[];
  readonly outputFormat: HeadlessOutputFormat;
  readonly maxTurns?: number | undefined;
}

/** A parse either yields a run, asks for help, or names the mistake. */
export type HeadlessParse =
  | { readonly kind: 'run'; readonly invocation: HeadlessInvocation }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage'; readonly message: string };

/** The process environment, as far as the runner reads it. */
export type HeadlessEnvironment = Readonly<Record<string, string | undefined>>;

/** Where the runner writes; injected so output is testable without a process. */
export interface HeadlessIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}
