import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  buildCapabilityManifest,
  type CapabilityManifest,
  type ExecutionTarget,
} from '../core/runtime/capability-manifest';

import { browserToolDefinition } from './browser-tool-executor';
import { containerToolDefinition } from './container-tool-executor';
import { databaseToolDefinition } from './database-tool-executor';
import { developmentServiceToolDefinition } from './development-service-tool-executor';
import { elevationToolDefinition } from './elevation-tool-executor';
import { evidenceToolDefinition } from './evidence-tool-executor';
import { flagshipToolDefinition } from './flagship-tool-executor';
import { gitToolDefinition } from './git-tool-executor';
import { integrationToolDefinition } from './integration-tool-executor';
import { intelligenceToolDefinition } from './intelligence-tool-executor';
import { planningToolDefinition } from './planning-tool-executor';
import { processSupervisorToolDefinition } from './process-supervisor-tool-executor';
import { qualityToolDefinition } from './quality-tool-executor';
import { runJournalToolDefinition } from './run-journal-tool-executor';
import { structuredCommandToolDefinition } from './structured-command-tool-executor';
import { subAgentToolDefinition } from './sub-agent-tool-executor';
import { workspaceFilesystemToolDefinition } from './vscode-filesystem-tool-executor';

import type {
  ExtensionHostDescriptor,
  RuntimeArchitecture,
  RuntimeHostKind,
  RuntimeHostProbe,
  RuntimeManifestIdentity,
  RuntimeOsFamily,
} from './vscode-runtime-target.types';

const knownShells = ['powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'fish', 'nushell'] as const;

export function detectRuntimePrerequisites(
  extensionRoot: string,
): RuntimeHostProbe['prerequisites'] {
  const executable = (names: readonly string[]): boolean =>
    names.some((name) => {
      if (path.isAbsolute(name)) return existsSync(name);
      const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
      return (process.env.PATH ?? process.env.Path ?? '')
        .split(path.delimiter)
        .some((directory) =>
          extensions.some((suffix) => existsSync(path.join(directory, `${name}${suffix}`))),
        );
    });
  const helper = path.join(extensionRoot, 'resources', 'elevation-helper.mjs');
  const helperDigest = `${helper}.sha256`;
  let elevation = false;
  if (existsSync(helper) && existsSync(helperDigest)) {
    const actual = createHash('sha256').update(readFileSync(helper)).digest('hex');
    const expected = readFileSync(helperDigest, 'utf8').trim().split(/\s+/u)[0];
    elevation = actual === expected && executable(['node', process.execPath]);
  }
  return {
    browser: hasInstalledPlaywrightBrowser(extensionRoot),
    container: executable(['docker', 'podman']),
    database: executable(['psql', 'mysql', 'sqlite3', 'mongosh']),
    elevation,
    git: executable(['git']),
    process: process.platform === 'win32' || executable(['sh', 'bash', 'zsh']),
  };
}

function hasInstalledPlaywrightBrowser(extensionRoot: string): boolean {
  const registry = path.join(extensionRoot, 'browsers.json');
  if (!existsSync(registry)) return false;
  let revision: string | undefined;
  try {
    const parsed = JSON.parse(readFileSync(registry, 'utf8')) as {
      readonly browsers?: readonly { readonly name?: string; readonly revision?: string }[];
    };
    revision = parsed.browsers?.find(({ name }) => name === 'chromium')?.revision;
  } catch {
    return false;
  }
  if (revision === undefined) return false;
  const cacheRoot = playwrightCacheRoot(extensionRoot);
  const executable = playwrightExecutableParts();
  return existsSync(path.join(cacheRoot, `chromium-${revision}`, ...executable));
}

function playwrightCacheRoot(extensionRoot: string): string {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (configured === '0') {
    return path.join(extensionRoot, 'node_modules', 'playwright-core', '.local-browsers');
  }
  if (configured !== undefined && path.isAbsolute(configured)) return configured;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright');
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  return path.join(homedir(), '.cache', 'ms-playwright');
}

function playwrightExecutableParts(): readonly string[] {
  if (process.platform === 'win32') return ['chrome-win64', 'chrome.exe'];
  if (process.platform === 'darwin') {
    return ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'];
  }
  return ['chrome-linux', 'chrome'];
}

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
    id: 'target:workspace',
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
    online: false,
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

  const targets: ExecutionTarget[] = [target];
  if (probe.workspaceTrusted && target.workspaceRoots.length > 0) {
    const localDefinitions = localToolDefinitions(probe);
    target.capabilities.push(...localDefinitions.map(({ name }) => name));
    tools.push(
      ...localDefinitions.map(({ description, inputSchema, schemaVersion, ...definition }) => {
        void description;
        void inputSchema;
        void schemaVersion;
        return definition;
      }),
    );
    const specializedTargets = [
      ...(probe.prerequisites.container
        ? [
            {
              id: 'target:container',
              label: 'Workspace container engine',
              definition: containerToolDefinition,
            },
          ]
        : []),
      ...(probe.prerequisites.database
        ? [
            {
              id: 'target:database',
              label: 'Approved database profiles',
              definition: databaseToolDefinition,
            },
          ]
        : []),
      ...(probe.prerequisites.browser
        ? [
            {
              id: 'target:browser',
              label: 'Isolated Playwright browser',
              definition: browserToolDefinition,
            },
          ]
        : []),
    ] as const;
    for (const specialized of specializedTargets) {
      targets.push({
        ...target,
        id: specialized.id,
        label: specialized.label,
        capabilities: [specialized.definition.name],
      });
      const { description, inputSchema, schemaVersion, ...definition } = specialized.definition;
      void description;
      void inputSchema;
      void schemaVersion;
      tools.push(definition);
    }
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
    targets,
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

function localToolDefinitions(probe: RuntimeHostProbe) {
  const definitions = [
    workspaceFilesystemToolDefinition,
    intelligenceToolDefinition,
    planningToolDefinition,
    runJournalToolDefinition,
    evidenceToolDefinition,
  ];
  if (probe.prerequisites.process) {
    definitions.push(
      structuredCommandToolDefinition,
      processSupervisorToolDefinition,
      qualityToolDefinition,
      developmentServiceToolDefinition,
    );
  }
  if (probe.prerequisites.git) definitions.push(gitToolDefinition, integrationToolDefinition);
  if (probe.prerequisites.git && probe.prerequisites.process) {
    definitions.push(subAgentToolDefinition, flagshipToolDefinition);
  }
  if (probe.prerequisites.elevation) definitions.push(elevationToolDefinition);
  return definitions;
}
