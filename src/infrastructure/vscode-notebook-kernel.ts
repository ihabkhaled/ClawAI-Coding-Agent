import * as vscode from 'vscode';

import { applyRunBudget, boundCellOutput } from '../core/notebook-execution';
import { JUPYTER_EXTENSION_ID, MAX_CELLS_PER_RUN } from '../core/notebook-execution.constants';

import type {
  NotebookCellRun,
  NotebookKernelRequest,
  NotebookRunResult,
} from '../core/notebook-execution.types';
import type { NotebookKernelPort } from '../services/notebook-tool.types';

const POLL_MS = 200;

/**
 * Runs notebook cells through the editor's own kernel machinery.
 *
 * The Jupyter extension owns kernel discovery, startup and the wire protocol;
 * this only asks it to run cells and reads what the cells report. That keeps
 * the agent on the same kernel the user sees, and means nothing here can start
 * a process the user's editor would not.
 *
 * Outputs live in the editor's in-memory notebook. They are deliberately not
 * saved: writing them back would be an unreviewed file change, and file edits
 * go through the reviewed transaction path.
 */
export class VscodeNotebookKernel implements NotebookKernelPort {
  constructor(private readonly workspaceRootUri: (rootKey: string) => vscode.Uri) {}

  async run(request: NotebookKernelRequest, signal?: AbortSignal): Promise<NotebookRunResult> {
    if (vscode.extensions.getExtension(JUPYTER_EXTENSION_ID) === undefined) {
      return {
        status: 'unavailable',
        reason: `The Jupyter extension (${JUPYTER_EXTENSION_ID}) is not installed, so there is no kernel to run cells on.`,
      };
    }
    const uri = vscode.Uri.joinPath(this.workspaceRootUri(request.rootKey), request.path);
    const document = await vscode.workspace.openNotebookDocument(uri);
    const targets = this.targets(document, request.index);
    const editor = await vscode.window.showNotebookDocument(document, {
      preserveFocus: true,
      preview: false,
    });
    if (request.kernelId !== undefined) {
      await vscode.commands.executeCommand('notebook.selectKernel', {
        notebookEditor: editor,
        id: request.kernelId,
        extension: JUPYTER_EXTENSION_ID,
      });
    }
    const before = new Map(targets.map((index) => [index, endTime(document, index)]));
    for (const range of contiguous(targets)) {
      await vscode.commands.executeCommand('notebook.cell.execute', {
        ranges: [range],
        document: uri,
      });
    }
    const finished = await this.waitFor(document, targets, before, request.timeoutMs, signal);
    const cells = applyRunBudget(targets.map((index) => this.report(document, index)));
    if (finished) return { status: 'completed', cells };
    return {
      status: 'timed-out',
      cells,
      note:
        'The kernel did not finish in time. If no kernel is selected the editor is waiting for a ' +
        'choice; pass kernelId or select one in the notebook first.',
    };
  }

  private targets(document: vscode.NotebookDocument, index: number | undefined): number[] {
    if (index !== undefined) {
      const cell = document.cellAt(index);
      if (cell.kind !== vscode.NotebookCellKind.Code) {
        throw new Error(`Cell ${String(index)} is not a code cell`);
      }
      return [index];
    }
    const code: number[] = [];
    for (let position = 0; position < document.cellCount; position += 1) {
      if (document.cellAt(position).kind === vscode.NotebookCellKind.Code) code.push(position);
    }
    if (code.length > MAX_CELLS_PER_RUN) {
      throw new Error(
        `Notebook has more than ${String(MAX_CELLS_PER_RUN)} code cells; run them by index`,
      );
    }
    return code;
  }

  private async waitFor(
    document: vscode.NotebookDocument,
    targets: readonly number[],
    before: ReadonlyMap<number, number | undefined>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const done = targets.every((index) => {
        const finishedAt = endTime(document, index);
        return finishedAt !== undefined && finishedAt !== before.get(index);
      });
      if (done) return true;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return false;
  }

  private report(document: vscode.NotebookDocument, index: number): NotebookCellRun {
    const cell = document.cellAt(index);
    const items = cell.outputs.flatMap((output) =>
      output.items.map((item) => ({ mime: item.mime, bytes: item.data })),
    );
    const bounded = boundCellOutput(items);
    return {
      index,
      executionOrder: cell.executionSummary?.executionOrder ?? null,
      success: cell.executionSummary?.success ?? null,
      output: bounded.output,
      truncated: bounded.truncated,
    };
  }
}

function endTime(document: vscode.NotebookDocument, index: number): number | undefined {
  return document.cellAt(index).executionSummary?.timing?.endTime;
}

/** Groups sorted indexes into `[start, end)` ranges the execute command accepts. */
export function contiguous(indexes: readonly number[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const index of indexes) {
    const last = ranges.at(-1);
    if (last?.end === index) last.end = index + 1;
    else ranges.push({ start: index, end: index + 1 });
  }
  return ranges;
}
