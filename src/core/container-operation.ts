import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const identifier = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !value.startsWith('-'));
const workspacePath = z.string().min(1).max(4_096).refine(isSafeRelativeWorkspacePath);
const base = {
  rootKey: z.string().min(1).max(100),
  engine: z.enum(['auto', 'docker', 'podman']).default('auto'),
};
const ownedReceipt = z
  .object({
    engine: z.enum(['docker', 'podman']),
    resourceId: identifier,
    ownerId: z.string().min(1).max(200),
    runId: z.string().min(8).max(200),
    workspaceId: z.string().min(1).max(200),
    labelsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const containerOperationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...base,
      operation: z.enum(['engine-info', 'contexts', 'images', 'containers', 'networks', 'volumes']),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['logs', 'stats', 'inspect', 'health']),
      resource: identifier,
      tail: z.number().int().min(1).max(10_000).default(500),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('build'),
      contextPath: workspacePath,
      dockerfile: workspacePath.default('Dockerfile'),
      tag: identifier,
    })
    .strict(),
  z.object({ ...base, operation: z.literal('pull'), image: identifier }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('run'),
      image: identifier,
      name: identifier,
      arguments: z.array(z.string().max(32_768)).max(1_000).default([]),
      ports: z
        .array(
          z
            .object({
              host: z.number().int().min(1).max(65_535),
              container: z.number().int().min(1).max(65_535),
            })
            .strict(),
        )
        .max(100)
        .default([]),
      environment: z
        .record(
          z.string().regex(/^(?!.*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH))[A-Z_][A-Z0-9_]*$/iu),
          z.string().max(32_768),
        )
        .default({}),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('exec'),
      receipt: ownedReceipt,
      executable: identifier,
      arguments: z.array(z.string().max(32_768)).max(1_000).default([]),
      stdin: z.string().max(1_048_576).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['start', 'stop', 'restart', 'remove']),
      receipt: ownedReceipt,
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['compose-up', 'compose-down', 'compose-build']),
      composeFile: workspacePath,
      projectName: identifier,
      services: z.array(identifier).max(100).default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.enum(['compose-run', 'compose-exec']),
      composeFile: workspacePath,
      projectName: identifier,
      service: identifier,
      executable: identifier,
      arguments: z.array(z.string().max(32_768)).max(1_000).default([]),
    })
    .strict(),
]);

export type ContainerOperation = z.infer<typeof containerOperationSchema>;
export type ContainerOwnershipReceipt = z.infer<typeof ownedReceipt>;
