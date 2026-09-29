/**
 * The editor column a new chat tab should open in.
 *
 * Someone who parked their chat in a side group wants the next one there too,
 * not in whichever group happens to be active. The remembered column is used
 * only while that group still exists: a column closed since is not a place a
 * tab can open, and asking for it would make VS Code split a new one.
 */
export function resolvePlacementColumn(
  remembered: number | undefined,
  openColumns: readonly number[],
): number | undefined {
  if (remembered === undefined || !Number.isInteger(remembered) || remembered < 1) {
    return undefined;
  }
  return openColumns.includes(remembered) ? remembered : undefined;
}

/** Keeps only a column number that could have been written by this extension. */
export function sanitizeRememberedColumn(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9
    ? value
    : undefined;
}
