import {
  buildCapabilityManifest,
  type CapabilityManifest,
  type ExecutionTarget,
} from '../core/runtime/capability-manifest';

import type {
  ExtensionHostDescriptor,
  RuntimeArchitecture,
  RuntimeHostKind,
  RuntimeHostProbe,
  RuntimeManifestIdentity,
  RuntimeOsFamily,
} from './vscode-runtime-target.types';

const knownShells = ['powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'fish', 'nushell'] as const;

function hostKindFor(probe: RuntimeHostProbe): RuntimeHostKind {
  if (probe.remoteName === 'wsl') return 'remote-wsl';
  if (probe.remoteName === 'ssh-remote') return 'remote-ssh';
  if (probe.remoteName === 'dev-container') return 'dev-container';
  if (probe.remoteName === 'codespaces') return 'codespaces';
  if (probe.remoteName !== undefined && probe.remoteName.length > 0) return 'unknown';
  return probe.uiKind === 'web' ? 'web-limited' : 'desktop-local';
}

function osFamilyFor(platform: string): RuntimeOsFamily {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}

function architectureFor(architecture: string): RuntimeArchitecture {
  if (architecture === 'x64' || architecture === 'arm64' || architecture === 'arm') {
    return architecture;
  }
  return 'unknown';
}

function shellFor(shell: string | undefined): (typeof knownShells)[number] | undefined {
  const executable = shell
    ?.split(/[\\/]/u)
    .at(-1)
    ?.replace(/\.exe$/iu, '')
    .toLowerCase();
  return knownShells.find((candidate) => candidate === executable);
}

function targetKindFor(hostKind: RuntimeHostKind): ExecutionTarget['kind'] {
  const targetKinds: Partial<Record<RuntimeHostKind, ExecutionTarget['kind']>> = {
    'desktop-local': 'local',
    'remote-wsl': 'wsl',
    'remote-ssh': 'remote-ssh',
    'dev-container': 'dev-container',
    codespaces: 'codespace',
  };
  return targetKinds[hostKind] ?? 'unknown';
}

export function describeExtensionHost(probe: RuntimeHostProbe): ExtensionHostDescriptor {
  return {
    architecture: architectureFor(probe.architecture),
    extensionKind: probe.extensionKind,
    hostKind: hostKindFor(probe),
    osFamily: osFamilyFor(probe.platform),
    remoteName: probe.remoteName,
    uiKind: probe.uiKind,
  };
}

export function describeRuntimeTarget(probe: RuntimeHostProbe): ExecutionTarget {
  const host = describeExtensionHost(probe);
  const shell = shellFor(probe.shell);
  const writable =
    probe.workspaceTrusted &&
    probe.workspaceFolders.length > 0 &&
    probe.workspaceFolders.every((folder) => folder.scheme === 'file');

  return {
    id: 'target:primary',
    kind: targetKindFor(host.hostKind),
    label: 'Current VS Code workspace',
    hostKind: host.hostKind,
    osFamily: host.osFamily,
    architecture: host.architecture,
    shells: shell === undefined ? [] : [shell],
    defaultShell: shell,
    workspaceRoots: probe.workspaceFolders.map((folder, index) => ({
      rootKey: `workspace-${String(index + 1)}`,
      uri: folder.uri,
      access: writable ? 'read-write' : 'read',
    })),
    online: true,
    capabilities: writable ? ['legacy.chat', 'legacy.edit-plan'] : ['legacy.chat'],
  };
}

export function buildRuntimeCapabilityManifest(
  probe: RuntimeHostProbe,
  identity: RuntimeManifestIdentity,
): CapabilityManifest {
  const target = describeRuntimeTarget(probe);
  const tools: CapabilityManifest['tools'] = [
    {
      name: 'legacy.chat',
      version: '1.0',
      operations: ['request'],
      riskClasses: ['network'],
      targetIds: [target.id],
    },
  ];
  if (target.capabilities.includes('legacy.edit-plan')) {
    tools.push({
      name: 'legacy.edit-plan',
      version: '1.0',
      operations: ['propose', 'apply-approved'],
      riskClasses: ['workspace-write'],
      targetIds: [target.id],
    });
  }

  return buildCapabilityManifest({
    protocolVersion: '2.0',
    manifestId: identity.manifestId,
    generatedAt: identity.generatedAt,
    extension: {
      name: 'clawai-coding-agent',
      version: probe.extensionVersion,
      vscodeVersion: probe.vscodeVersion,
      hostKind: target.hostKind,
    },
    targets: [target],
    tools,
    policy: {
      mode: 'manual',
      workspaceTrusted: probe.workspaceTrusted,
      immutableDenials: ['secret-read', 'hidden-reasoning', 'unscoped-effects'],
      approvalClasses: ['workspace-write'],
      networkPolicy: 'allowlisted',
      secretHandling: 'host-mediated-never-model-readable',
    },
  });
}
