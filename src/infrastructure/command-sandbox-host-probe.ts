import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import {
  SANDBOX_CREDENTIAL_PATHS,
  SANDBOX_HELPER_EXECUTABLES,
} from '../core/command-sandbox.constants';

import { present } from './vscode-sandbox-probe';

import type {
  CommandSandboxCredentialPath,
  CommandSandboxHost,
} from '../core/command-sandbox.types';

/** The real path, so a symlinked /var or /tmp matches what the kernel checks. */
export function realPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

export function existingCredentials(home: string): CommandSandboxCredentialPath[] {
  const found: CommandSandboxCredentialPath[] = [];
  for (const relative of SANDBOX_CREDENTIAL_PATHS) {
    const candidate = path.posix.join(home, relative);
    try {
      const stats = statSync(candidate);
      found.push({ path: candidate, kind: stats.isDirectory() ? 'directory' : 'file' });
    } catch {
      // Absent: nothing to mask.
    }
  }
  return found;
}

/**
 * What this host can confine a command with, probed once.
 *
 * Helpers are probed only on the platform that can use them; docker is probed
 * everywhere because a container is the one real sandbox Windows has.
 */
export function probeCommandSandboxHost(): CommandSandboxHost {
  const platform = process.platform;
  const home = realPath(homedir());
  return {
    platform,
    bubblewrap: platform === 'linux' && present(SANDBOX_HELPER_EXECUTABLES.bubblewrap),
    sandboxExec: platform === 'darwin' && present(SANDBOX_HELPER_EXECUTABLES.seatbelt),
    docker: present(SANDBOX_HELPER_EXECUTABLES.docker),
    homeDirectory: home,
    temporaryDirectories: [realPath(tmpdir())],
    existingCredentialPaths: platform === 'linux' ? existingCredentials(home) : [],
  };
}
