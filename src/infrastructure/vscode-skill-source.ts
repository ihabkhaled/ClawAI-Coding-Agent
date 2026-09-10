import * as vscode from 'vscode';

import type { SkillFile, SkillSourcePort } from '../services/skill-catalog.types';

/** How many skill files one directory may contribute before the list stops being a list. */
const MAX_SKILL_FILES = 200;

/** Skill files larger than this are almost certainly not a command prompt. */
const MAX_SKILL_BYTES = 128 * 1024;

async function readDirectory(directory: vscode.Uri): Promise<SkillFile[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(directory);
  } catch {
    // A missing skills directory is the ordinary case, not a failure.
    return [];
  }
  const files: SkillFile[] = [];
  for (const [fileName, kind] of entries) {
    if (files.length >= MAX_SKILL_FILES) break;
    if (kind !== vscode.FileType.File || !fileName.endsWith('.md')) continue;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory, fileName));
      if (bytes.byteLength > MAX_SKILL_BYTES) continue;
      files.push({ fileName, content: new TextDecoder('utf-8', { fatal: false }).decode(bytes) });
    } catch {
      continue;
    }
  }
  return files;
}

/**
 * Where slash commands come from: `.clawai/skills` in the project, and a
 * `skills` directory in this VS Code profile's global storage.
 *
 * Both are plain directories of Markdown. Nothing has to be registered and no
 * command has to be run to add one — a file is the whole interface, which is
 * what makes a skill something a repository can ship in a pull request.
 */
export class VscodeSkillSource implements SkillSourcePort {
  constructor(
    private readonly globalStorageUri: vscode.Uri,
    private readonly projectFolder: () => vscode.Uri | undefined,
  ) {}

  async global(): Promise<readonly SkillFile[]> {
    return readDirectory(vscode.Uri.joinPath(this.globalStorageUri, 'skills'));
  }

  async project(): Promise<readonly SkillFile[]> {
    const folder = this.projectFolder();
    if (folder === undefined) return [];
    return readDirectory(vscode.Uri.joinPath(folder, '.clawai', 'skills'));
  }
}
