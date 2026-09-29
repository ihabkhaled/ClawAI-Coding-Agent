/**
 * Credential stores under home that a sandboxed command must not read.
 *
 * Reads elsewhere stay allowed, because a compiler needs `/usr` and a package
 * manager its cache; what must not leak is the thing that authenticates you.
 */
export const SANDBOX_CREDENTIAL_PATHS: readonly string[] = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.config/gh',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
];

/** Where the workspace is mounted inside a container. */
export const CONTAINER_WORKSPACE = '/workspace';

/** Process ceiling inside a container, so a fork bomb stops at the wall. */
export const CONTAINER_PIDS_LIMIT = 512;

export const COMMAND_SANDBOX_MODES = ['off', 'auto', 'bubblewrap', 'seatbelt', 'docker'] as const;

/** Host helper executables, by mechanism. */
export const SANDBOX_HELPER_EXECUTABLES = {
  bubblewrap: 'bwrap',
  seatbelt: 'sandbox-exec',
  docker: 'docker',
} as const;
