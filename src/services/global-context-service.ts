import * as vscode from 'vscode';

export type GlobalContextKind = 'rules' | 'skills';

const GLOBAL_FILES: Record<GlobalContextKind, { name: string; initialContent: string }> = {
  rules: {
    name: 'global-rules.md',
    initialContent:
      '# Global ClawAI rules\n\nAdd non-secret rules that should apply across every workspace on this VS Code profile.\n',
  },
  skills: {
    name: 'global-skills.md',
    initialContent:
      '# Global ClawAI skills\n\nAdd reusable, non-secret coding guidance that should apply across workspaces.\n',
  },
};

export interface GlobalContextPort {
  readAll(): Promise<string>;
}

export class GlobalContextService implements GlobalContextPort {
  constructor(private readonly storageUri: vscode.Uri) {}

  async open(kind: GlobalContextKind): Promise<void> {
    const file = GLOBAL_FILES[kind];
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const uri = vscode.Uri.joinPath(this.storageUri, file.name);
    if (!(await this.exists(uri))) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(file.initialContent));
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async readAll(): Promise<string> {
    const sections: string[] = [];
    for (const file of Object.values(GLOBAL_FILES)) {
      const content = await this.readOptional(vscode.Uri.joinPath(this.storageUri, file.name));
      if (content !== null) {
        sections.push(`# ${file.name}\n${content}`);
      }
    }
    return sections.join('\n\n');
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return false;
      }
      throw error;
    }
  }

  private async readOptional(uri: vscode.Uri): Promise<string | null> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return null;
      }
      throw error;
    }
  }
}
