/**
 * Stand-ins for the fields of a policy request that say WHERE a call happens.
 *
 * The mode decision reads effect, risk and mode only. A headless run has no
 * account epoch, backend origin or editor workspace id to put in them, and the
 * request schema wants something well formed, so these fill the slots without
 * carrying any meaning.
 */
export const HEADLESS_POLICY_SCOPE = {
  accountId: 'headless',
  backendOrigin: 'https://headless.invalid',
  workspaceId: 'headless',
  targetId: 'target:workspace',
  root: '/',
} as const;

export const HEADLESS_POLICY_RUN_ID = 'headless';

/** A well-formed invocation hash; the mode decision never reads it. */
export const HEADLESS_POLICY_INVOCATION_HASH = `sha256:${'0'.repeat(64)}`;

/**
 * How the headless tool names are spelled in the policy's classification table,
 * where the file tool is plural and git's staging verbs carry other names.
 */
export const HEADLESS_POLICY_TOOL_NAMES: Readonly<Record<string, string>> = {
  'workspace.file': 'workspace.files',
};

export const HEADLESS_POLICY_OPERATION_NAMES: Readonly<Record<string, string>> = {
  add: 'stage',
  switch: 'create-branch',
  restore: 'revert',
};
