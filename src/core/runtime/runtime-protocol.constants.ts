export const RUNTIME_PROTOCOL_V1 = '1.0';
export const RUNTIME_PROTOCOL_V2 = '2.0';

export const RUNTIME_PROTOCOL_VERSIONS = [RUNTIME_PROTOCOL_V2, RUNTIME_PROTOCOL_V1] as const;

export const RUNTIME_TRANSPORTS = ['sse'] as const;

export const RUNTIME_EVENT_VISIBILITIES = ['user', 'audit', 'internal-state'] as const;

export const RUNTIME_EVENT_SENSITIVITIES = ['public', 'workspace', 'sensitive-redacted'] as const;

export const RUNTIME_EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
export const RUNTIME_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{7,127}$/u;
export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const EXECUTION_HOST_KINDS = [
  'desktop-local',
  'remote-wsl',
  'remote-ssh',
  'dev-container',
  'codespaces',
  'web-limited',
  'unknown',
] as const;

export const EXECUTION_TARGET_KINDS = [
  'local',
  'wsl',
  'remote-ssh',
  'dev-container',
  'docker-container',
  'codespace',
  'custom-broker',
  'unknown',
] as const;

export const OS_FAMILIES = ['windows', 'macos', 'linux', 'unknown'] as const;
export const CPU_ARCHITECTURES = ['x64', 'arm64', 'arm', 'unknown'] as const;
export const SHELL_KINDS = [
  'bash',
  'sh',
  'zsh',
  'fish',
  'powershell',
  'pwsh',
  'cmd',
  'nushell',
  'custom',
] as const;

export const WORKSPACE_ACCESS_LEVELS = ['read', 'read-write', 'external-output'] as const;
export const CAPABILITY_RISK_CLASSES = [
  'inspect',
  'workspace-write',
  'external-write',
  'network',
  'process',
  'git-mutate',
  'container-mutate',
  'database-read',
  'database-write',
  'browser',
  'elevation',
  'publish',
  'destructive',
] as const;

export const CAPABILITY_POLICY_MODES = [
  'manual',
  'edit-automatically',
  'full-access-scoped',
] as const;

export const NETWORK_POLICY_MODES = ['off', 'allowlisted', 'unrestricted-with-approval'] as const;

export const SECRET_LIKE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|credential|password|private[-_]?key|refresh[-_]?token|secret|token)/iu;
