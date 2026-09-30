import { createHash } from 'node:crypto';

import type { HookApproval } from './plugin-hook-approval.types';
import type { PluginManifest, PluginSwitches } from './plugin-manifest.types';

/** Each hook as the line a person reads and approves: its command and arguments. */
export function hookCommandLines(manifest: PluginManifest): string[] {
  return manifest.contributes.hooks.map((hook) => [hook.command, ...hook.arguments].join(' '));
}

/**
 * A digest of the exact hooks and the plugin version.
 *
 * Any edit to a hook, and any update or `git pull` that moves the version,
 * gives a different digest, so an approval cannot outlive what was approved.
 */
export function hooksDigest(manifest: PluginManifest): string {
  const canonical = JSON.stringify({
    version: manifest.version,
    hooks: manifest.contributes.hooks,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** What a stored switch set means for a plugin whose hooks digest to `digest` now. */
export function evaluateHookApproval(
  switches: PluginSwitches | undefined,
  manifest: PluginManifest,
): HookApproval {
  const all = hookCommandLines(manifest);
  if (!switches?.hooksEnabled) {
    return { status: 'off', changedCommands: all };
  }
  if (switches.hooksDigest === undefined) return { status: 'legacy', changedCommands: all };
  if (switches.hooksDigest === hooksDigest(manifest)) {
    return { status: 'approved', changedCommands: [] };
  }
  const known = new Set(switches.approvedCommands ?? []);
  const fresh = all.filter((line) => !known.has(line));
  return { status: 'changed', changedCommands: fresh.length > 0 ? fresh : all };
}
