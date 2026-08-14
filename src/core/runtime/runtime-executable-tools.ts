import type { CapabilityManifest } from './capability-manifest';
import type { ToolDefinition } from './runtime-tool-contracts';

/**
 * Narrows the offered tool list to what the registered targets can actually run.
 *
 * Two lists describe the same runtime and they were allowed to disagree. The
 * list the model is offered comes from the router, which registers every
 * executor unconditionally. The list the dispatcher enforces comes from the
 * capability manifest, whose targets only advertise the local tools when the
 * workspace is trusted. A window that activated untrusted therefore offered
 * seventeen tools and could execute none of them: `workspace.files`,
 * `workspace.command`, `workspace.process` and `workspace.git` each came back
 * `Execution target does not provide the requested capability`, and the model —
 * having been told the tools existed — worked through all of them before
 * concluding the runtime had no way to commit.
 *
 * Offering only executable tools makes that disagreement unrepresentable. When
 * a capability is missing the model is never told it exists, so it reports the
 * limit instead of failing four times discovering it.
 */
export function executableToolDefinitions(
  definitions: readonly ToolDefinition[],
  manifest: CapabilityManifest,
): readonly ToolDefinition[] {
  const executable = new Set(manifest.targets.flatMap((target) => target.capabilities));
  return definitions.filter((definition) => executable.has(definition.name));
}
