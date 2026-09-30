import type * as vscode from 'vscode';

/** Anything that can answer "what are your top-level rows?", sync or async. */
interface ProbeableProvider {
  getChildren(
    element?: never,
  ): vscode.ProviderResult<readonly vscode.TreeItem[] | readonly object[]>;
}

const providers = new Map<string, ProbeableProvider>();

/**
 * Remembers each tree provider under its view id so the extension-host test
 * can ask a view for its rows. Nothing in the product reads this; only the
 * test API (present under `ExtensionMode.Test`) does.
 */
export function recordTreeProbe(viewId: string, provider: ProbeableProvider): void {
  providers.set(viewId, provider);
}

/** The number of top-level rows a view returns, or undefined if none is registered. */
export async function probeTreeChildren(viewId: string): Promise<number | undefined> {
  const provider = providers.get(viewId);
  if (provider === undefined) return undefined;
  return (await provider.getChildren())?.length ?? 0;
}

export function probedViewIds(): readonly string[] {
  return [...providers.keys()];
}
