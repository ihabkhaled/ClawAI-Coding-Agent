import { describe, expect, it } from 'vitest';

import { parseCapabilityManifest } from '../../src/core/runtime/capability-manifest';

const target = {
  id: 'target:local',
  kind: 'local',
  label: 'Local workspace',
  hostKind: 'desktop-local',
  osFamily: 'windows',
  architecture: 'x64',
  shells: ['powershell', 'cmd'],
  workspaceRoots: [
    {
      rootKey: 'workspace-1',
      uri: 'file:///D:/workspace',
      access: 'read-write',
    },
  ],
  online: true,
  capabilities: ['legacy.chat', 'legacy.edit-plan'],
  limits: {
    maxOutputBytesPerTool: 262_144,
    maxRuntimeSeconds: 300,
  },
};

const manifest = {
  protocolVersion: '2.0',
  manifestId: 'manifest_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  generatedAt: '2026-08-02T03:00:00.000Z',
  extension: {
    name: 'clawai-coding-agent',
    version: '0.18.0',
    vscodeVersion: '1.110.0',
    hostKind: 'desktop-local',
  },
  targets: [target],
  tools: [
    {
      name: 'legacy.edit-plan',
      version: '1.0',
      operations: ['propose'],
      riskClasses: ['workspace-write'],
      targetIds: ['target:local'],
      limits: {
        maxFiles: 50,
      },
    },
  ],
  policy: {
    mode: 'manual',
    workspaceTrusted: true,
    immutableDenials: ['secret-read', 'hidden-reasoning'],
    approvalClasses: ['workspace-write'],
    networkPolicy: 'allowlisted',
    secretHandling: 'host-mediated-never-model-readable',
  },
};

describe('capability manifest', () => {
  it('round-trips a truthful strict V2 manifest', () => {
    expect(parseCapabilityManifest(manifest)).toEqual(manifest);
  });

  it('rejects unknown fields at every trusted boundary', () => {
    expect(() => parseCapabilityManifest({ ...manifest, rawEnvironment: {} })).toThrow();
    expect(() =>
      parseCapabilityManifest({
        ...manifest,
        targets: [{ ...target, administrator: true }],
      }),
    ).toThrow();
  });

  it('rejects duplicate target and tool identifiers', () => {
    expect(() => parseCapabilityManifest({ ...manifest, targets: [target, target] })).toThrow(
      /duplicate target/i,
    );
    expect(() =>
      parseCapabilityManifest({ ...manifest, tools: [manifest.tools[0], manifest.tools[0]] }),
    ).toThrow(/duplicate tool/i);
  });

  it('rejects a tool that references an unknown target', () => {
    expect(() =>
      parseCapabilityManifest({
        ...manifest,
        tools: [{ ...manifest.tools[0], targetIds: ['target:missing'] }],
      }),
    ).toThrow(/unknown target/i);
  });

  it('rejects secret-shaped capability metadata', () => {
    expect(() =>
      parseCapabilityManifest({
        ...manifest,
        tools: [
          {
            ...manifest.tools[0],
            limits: { apiKey: 'sk-secret-value' },
          },
        ],
      }),
    ).toThrow(/secret/i);
  });

  it('supports truthful WSL and unknown host classifications', () => {
    const parsed = parseCapabilityManifest({
      ...manifest,
      extension: { ...manifest.extension, hostKind: 'remote-wsl' },
      targets: [{ ...target, kind: 'wsl', hostKind: 'remote-wsl', osFamily: 'linux' }],
    });

    expect(parsed.targets[0]?.kind).toBe('wsl');
    expect(
      parseCapabilityManifest({
        ...manifest,
        extension: { ...manifest.extension, hostKind: 'unknown' },
        targets: [{ ...target, kind: 'unknown', hostKind: 'unknown', osFamily: 'unknown' }],
      }).targets[0]?.kind,
    ).toBe('unknown');
  });

  it('allows a capability to omit optional numeric limits', () => {
    const toolWithoutLimits = { ...manifest.tools[0] };
    delete toolWithoutLimits.limits;

    expect(
      parseCapabilityManifest({ ...manifest, tools: [toolWithoutLimits] }).tools[0],
    ).not.toHaveProperty('limits');
  });
});
