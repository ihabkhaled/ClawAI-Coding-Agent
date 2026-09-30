import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { PluginFailure } from '../core/plugin-failure';
import { gitCloneArguments, gitCloneFolderName } from '../core/plugin-git-marketplace';
import {
  GIT_CLONE_OUTPUT_BYTES,
  GIT_CLONE_TIMEOUT_MS,
} from '../core/plugin-git-marketplace.constants';

import { runCommandSpec } from './bounded-command-runner';

import type { GitMarketplaceLocation } from '../core/plugin-marketplace.types';

/**
 * Clones a git marketplace, shallowly and afresh, under `base`.
 *
 * Through the bounded command runner: no shell, an allowlisted environment, a
 * timeout and an output cap. Every open replaces the previous clone, so the
 * catalog is always the ref's current content and never a stale checkout.
 * Prompts are off, so a private repository fails instead of waiting on a
 * credential dialog nobody can see.
 */
export async function cloneGitMarketplace(
  base: string,
  location: GitMarketplaceLocation,
): Promise<string> {
  const target = path.join(base, gitCloneFolderName(location));
  await rm(target, { recursive: true, force: true });
  await mkdir(base, { recursive: true });
  const result = await runCommandSpec(
    {
      executable: 'git',
      arguments: gitCloneArguments(location, target),
      cwdRootKey: 'plugin-marketplaces',
      cwd: '.',
      environment: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: GIT_CLONE_TIMEOUT_MS,
      outputLimitBytes: GIT_CLONE_OUTPUT_BYTES,
      expectedEffect: 'network',
      targetId: 'target:plugin-marketplace',
      elevation: false,
    },
    base,
  );
  if (result.exitCode !== 0 || result.timedOut) {
    await rm(target, { recursive: true, force: true });
    throw new PluginFailure('unreachable', location.url);
  }
  return target;
}
