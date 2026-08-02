import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { resolveExecutable } from '../infrastructure/bounded-command-runner';

const toolCandidates = [
  'pwsh',
  'powershell',
  'cmd',
  'bash',
  'sh',
  'zsh',
  'git',
  'wsl',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'python',
  'python3',
  'java',
  'javac',
  'dotnet',
  'go',
  'cargo',
  'rustc',
  'ruby',
  'php',
  'gradle',
  'gradlew',
  'xcodebuild',
  'make',
  'cmake',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'pytest',
  'apt',
  'dnf',
  'yum',
  'pacman',
  'apk',
  'zypper',
  'brew',
  'winget',
  'choco',
] as const;

export interface DiscoveredDevelopmentTool {
  readonly name: string;
  readonly path: string;
  readonly hash: string;
}

export class DevelopmentToolDiscoveryService {
  async discover(signal?: AbortSignal): Promise<readonly DiscoveredDevelopmentTool[]> {
    const discovered: DiscoveredDevelopmentTool[] = [];
    for (const name of toolCandidates) {
      signal?.throwIfAborted();
      try {
        const executablePath = await resolveExecutable(name);
        const hash = `sha256:${createHash('sha256')
          .update(await readFile(executablePath))
          .digest('hex')}`;
        discovered.push({ name, path: executablePath, hash });
      } catch {
        // Missing tools are capability facts, not discovery failures.
      }
    }
    return discovered;
  }
}
