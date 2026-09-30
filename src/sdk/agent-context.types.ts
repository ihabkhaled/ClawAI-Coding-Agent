import type { ContextReceipt } from '../core/context-collector';
import type { ContextMode } from '../core/context-mode';

/** Which context a run starts with; the same five modes as the editor's Context control. */
export interface AgentContextConfig {
  readonly mode: ContextMode;
  /** Workspace-relative file for `file`; its presence also stands for "a file is open" under `smart`. */
  readonly file?: string | undefined;
  /** `path:START-END` (1-indexed, inclusive) for `selection`; under `smart` it stands for "a selection exists". */
  readonly selection?: string | undefined;
}

/** What a file lookup reports, without its bytes. */
export interface AgentContextStat {
  readonly isFile: boolean;
  readonly size: number;
}

/** The file system the context builder reads through; injectable so tests can count lookups. */
export interface AgentContextFileSystem {
  /** Workspace-relative paths, at most `limit` of them, in a stable order. */
  readonly list: (root: string, limit: number) => Promise<readonly string[]>;
  /** The containment check and the stat, which is what `--speed` runs in parallel. */
  readonly stat: (root: string, relativePath: string) => Promise<AgentContextStat>;
  readonly read: (root: string, relativePath: string) => Promise<Uint8Array>;
}

/** The prompt to send, and what was put into it. */
export interface AgentContextResult {
  readonly prompt: string;
  /** The mode that ran: `smart` is reported as the mode it resolved to. */
  readonly resolved: Exclude<ContextMode, 'smart'>;
  readonly receipt?: ContextReceipt | undefined;
}
