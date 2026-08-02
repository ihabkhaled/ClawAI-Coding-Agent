import { z } from 'zod';

import {
  CAPABILITY_POLICY_MODES,
  CAPABILITY_RISK_CLASSES,
  CPU_ARCHITECTURES,
  EXECUTION_HOST_KINDS,
  EXECUTION_TARGET_KINDS,
  NETWORK_POLICY_MODES,
  OS_FAMILIES,
  RUNTIME_ID_PATTERN,
  RUNTIME_PROTOCOL_V2,
  SECRET_LIKE_KEY_PATTERN,
  SHELL_KINDS,
  WORKSPACE_ACCESS_LEVELS,
} from './runtime-protocol.constants';

const primitiveLimitSchema = z.union([z.number(), z.string().max(500), z.boolean()]);

const workspaceRootSchema = z
  .object({
    rootKey: z.string().min(1).max(100),
    uri: z.url().max(2_048),
    access: z.enum(WORKSPACE_ACCESS_LEVELS),
  })
  .strict();

const targetLimitsSchema = z
  .object({
    maxConcurrentProcesses: z.number().int().min(1).max(256).optional(),
    maxPtySessions: z.number().int().min(0).max(64).optional(),
    maxOutputBytesPerTool: z.number().int().min(1_024).max(16_777_216).optional(),
    maxRuntimeSeconds: z.number().int().min(1).max(86_400).optional(),
  })
  .strict();

const executionTargetSchema = z
  .object({
    id: z.string().regex(RUNTIME_ID_PATTERN),
    kind: z.enum(EXECUTION_TARGET_KINDS),
    label: z.string().min(1).max(200),
    hostKind: z.enum(EXECUTION_HOST_KINDS),
    osFamily: z.enum(OS_FAMILIES),
    distribution: z.string().max(100).nullable().optional(),
    architecture: z.enum(CPU_ARCHITECTURES),
    shells: z.array(z.enum(SHELL_KINDS)).min(1).max(10),
    defaultShell: z.enum(SHELL_KINDS).optional(),
    workspaceRoots: z.array(workspaceRootSchema).min(1).max(64),
    online: z.boolean(),
    capabilities: z.array(z.string().min(1).max(100)).max(256),
    limits: targetLimitsSchema.optional(),
  })
  .strict();

const capabilityToolSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z][a-z0-9_.-]+$/u),
    version: z.string().min(1).max(40),
    operations: z.array(z.string().min(1).max(80)).min(1).max(100),
    riskClasses: z.array(z.enum(CAPABILITY_RISK_CLASSES)).min(1).max(13),
    targetIds: z.array(z.string().regex(RUNTIME_ID_PATTERN)).min(1).max(32),
    limits: z.record(z.string().min(1).max(100), primitiveLimitSchema).optional(),
  })
  .strict();

const manifestPolicySchema = z
  .object({
    mode: z.enum(CAPABILITY_POLICY_MODES),
    workspaceTrusted: z.boolean(),
    immutableDenials: z.array(z.string().min(1).max(100)).max(100),
    approvalClasses: z.array(z.string().min(1).max(100)).max(100),
    networkPolicy: z.enum(NETWORK_POLICY_MODES),
    secretHandling: z.literal('host-mediated-never-model-readable'),
  })
  .strict();

const capabilityManifestSchema = z
  .object({
    protocolVersion: z.literal(RUNTIME_PROTOCOL_V2),
    manifestId: z.string().regex(RUNTIME_ID_PATTERN),
    generatedAt: z.iso.datetime({ offset: true }),
    extension: z
      .object({
        name: z.literal('clawai-coding-agent'),
        version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
        vscodeVersion: z.string().min(1).max(100),
        hostKind: z.enum(EXECUTION_HOST_KINDS),
      })
      .strict(),
    targets: z.array(executionTargetSchema).min(1).max(32),
    tools: z.array(capabilityToolSchema).min(1).max(256),
    policy: manifestPolicySchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const targetIds = manifest.targets.map((target) => target.id);
    const toolNames = manifest.tools.map((tool) => tool.name);
    addDuplicateIssue(targetIds, 'Duplicate target identifier', ['targets'], context);
    addDuplicateIssue(toolNames, 'Duplicate tool identifier', ['tools'], context);

    const knownTargets = new Set(targetIds);
    for (const [toolIndex, tool] of manifest.tools.entries()) {
      for (const targetId of tool.targetIds) {
        if (!knownTargets.has(targetId)) {
          context.addIssue({
            code: 'custom',
            message: `Tool references unknown target ${targetId}`,
            path: ['tools', toolIndex, 'targetIds'],
          });
        }
      }
      for (const key of Object.keys(tool.limits ?? {})) {
        if (SECRET_LIKE_KEY_PATTERN.test(key)) {
          context.addIssue({
            code: 'custom',
            message: `Secret-like capability metadata is forbidden: ${key}`,
            path: ['tools', toolIndex, 'limits', key],
          });
        }
      }
    }
  });

type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
type ManifestRefinementContext = z.core.$RefinementCtx<CapabilityManifest>;

function addDuplicateIssue(
  values: string[],
  message: string,
  path: PropertyKey[],
  context: ManifestRefinementContext,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message, path });
  }
}

export function parseCapabilityManifest(value: unknown): CapabilityManifest {
  return capabilityManifestSchema.parse(value);
}

export type { CapabilityManifest };
