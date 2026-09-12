import type { WindowHandoff } from '../core/window-handoff.types';
import type * as vscode from 'vscode';

/** What opening a conversation in another window needs to reach. */
export interface NewWindowDependencies {
  readonly activeThreadId: () => string | undefined;
  readonly workspaceFolder: () => vscode.Uri | undefined;
  readonly readHandoff: () => WindowHandoff | undefined;
  readonly storeHandoff: (handoff: WindowHandoff | undefined) => Promise<void>;
  readonly openFolderInNewWindow: (folder: vscode.Uri) => Promise<void>;
  readonly openThread: (threadId: string) => Promise<void>;
  readonly now: () => number;
}
