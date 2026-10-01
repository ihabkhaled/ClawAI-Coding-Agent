export const CI_NODE_IMAGE: string;
export const CONTAINER_SCRIPT: string;
export const PUSH_ARGS: readonly string[];
export const SECRET_SHAPES: readonly (readonly [string, RegExp])[];
export function dockerRunArgs(image?: string): string[];
export function releaseAssetPaths(version: string): string[];
export function releaseGateProblems(input: {
  readonly version: string;
  readonly remoteTags: readonly string[];
}): string[];
export function secretShapedAdditions(
  diffText: string,
): { readonly file: string; readonly label: string }[];
export function gateVerdict(
  runs: readonly { readonly name: string; readonly status: string; readonly conclusion?: string }[],
  expectedWorkflows?: readonly string[],
): { readonly state: 'red' | 'green' | 'pending' | 'superseded'; readonly failed: string[] };
