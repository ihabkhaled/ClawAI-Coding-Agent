/**
 * Environment variables a spawned command is allowed to see.
 *
 * An allowlist rather than a denylist, because the set of variables that carry a
 * credential is unbounded and grows every time someone adds one. Whatever is not
 * named here does not reach the child, so a token in the parent's environment
 * cannot be read by a command the model chose.
 *
 * gh reads its auth state from %APPDATA%\GitHub CLI\hosts.yml; without APPDATA
 * every gh command fails with "You are not logged into any GitHub hosts". That
 * was proven by spawning `gh auth status` with the allowlist and adding one
 * variable at a time; APPDATA alone made it succeed. LOCALAPPDATA and the XDG_*
 * directories are here for the same class of config, data and cache locations,
 * and none of these carry credentials.
 */
export const INHERITED_ENVIRONMENT_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'LANG',
  'LC_ALL',
] as const;
