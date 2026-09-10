import { spawnSync } from 'node:child_process';
import { platform } from 'node:process';

import { chooseSandbox, sandboxGuarantees } from '../core/sandbox-capability';

import type { SandboxGuarantees } from '../core/sandbox-capability.types';

/** The helpers worth looking for, by the platform that can use them. */
const HELPERS: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  linux: ['bwrap'],
  darwin: ['sandbox-exec'],
};

/**
 * Whether a helper is on PATH, asked once and cheaply.
 *
 * `--version` rather than `which`: `which` is not everywhere, and a helper that
 * exists but cannot run is not a helper. The call is bounded and its output
 * discarded — the exit code is the whole answer.
 */
function present(executable: string): boolean {
  try {
    const result = spawnSync(executable, ['--version'], {
      timeout: 2_000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.error === undefined && result.status !== null;
  } catch {
    return false;
  }
}

/**
 * What this host can actually isolate, probed once at startup.
 *
 * Probed rather than assumed, because the answer differs between a developer's
 * laptop, a devcontainer and a CI image running the same extension. Cached for
 * the session: the answer cannot change while the process runs, and spawning a
 * probe per command would spend more time asking than the isolation saves.
 */
export class VscodeSandboxProbe {
  private cached: SandboxGuarantees | undefined;

  guarantees(): SandboxGuarantees {
    this.cached ??= sandboxGuarantees(
      chooseSandbox({
        platform,
        available: (HELPERS[platform] ?? []).filter((helper) => present(helper)),
      }),
    );
    return this.cached;
  }
}
