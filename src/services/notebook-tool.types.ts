import type { NotebookKernelRequest, NotebookRunResult } from '../core/notebook-execution.types';

/** Reading a notebook file, narrowed to the one call the tool makes. */
export interface NotebookReaderPort {
  read(rootKey: string, path: string): Promise<string>;
}

/**
 * Runs cells on a kernel the editor already knows how to reach.
 *
 * The answer is `unavailable` rather than a throw when there is no kernel
 * provider, so the model is told the honest reason instead of retrying.
 */
export interface NotebookKernelPort {
  run(request: NotebookKernelRequest, signal?: AbortSignal): Promise<NotebookRunResult>;
}
