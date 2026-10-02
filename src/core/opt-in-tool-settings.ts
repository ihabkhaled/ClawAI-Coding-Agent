/** The opt-in tools' settings, as plain values. Read from user scope only; see the reader. */
export interface OptInToolValues {
  readonly httpAllowHosts: readonly string[];
  readonly shellEnabled: boolean;
  readonly shellDeny: readonly string[];
}

/** The most entries read from a list setting; a longer list is cut, not trusted. */
const MAX_LIST_ENTRIES = 64;
const MAX_ENTRY_CHARACTERS = 300;

/** The non-empty strings of a setting value, trimmed and bounded; anything else is nothing. */
export function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_ENTRY_CHARACTERS)
    .slice(0, MAX_LIST_ENTRIES);
}

/**
 * Reads the three values through `userValue`, which returns the user-scope
 * value of a setting and never the workspace's.
 *
 * Why not the merged value: these settings let the agent reach a host or run a
 * script. A cloned repository's `.vscode/settings.json` must not be able to
 * grant that, the same reason the command sandbox is read this way.
 */
export function readOptInToolValues(userValue: (key: string) => unknown): OptInToolValues {
  return {
    httpAllowHosts: stringList(userValue('tools.httpAllowHosts')),
    shellEnabled: userValue('tools.shellEnabled') === true,
    shellDeny: stringList(userValue('tools.shellDeny')),
  };
}
