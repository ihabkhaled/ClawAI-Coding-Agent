import { z } from 'zod';

import { commandSpecSchema } from './command-spec';

export const serviceDefinitionSchema = z
  .object({
    serviceId: z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/u),
    label: z.string().min(1).max(200),
    kind: z.enum(['process', 'container', 'compose', 'vscode-task']),
    targetId: z.string().min(8).max(200),
    dependencies: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/u)).max(100),
    command: commandSpecSchema.optional(),
    containerOperation: z.record(z.string(), z.unknown()).optional(),
    expectedPorts: z.array(z.number().int().min(1).max(65_535)).max(100),
    readinessUrl: z.url().max(4_096).optional(),
    readinessPattern: z.string().max(1_000).optional(),
    environmentOverlay: z
      .record(
        z
          .string()
          .regex(/^(?!.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH))[A-Z_][A-Z0-9_]{0,99}$/iu),
        z.string().max(32_768),
      )
      .default({}),
    restartPolicy: z.enum(['never', 'on-failure', 'on-change']).default('on-failure'),
    maxRestarts: z.number().int().min(0).max(20).default(3),
    restartWindowMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.kind === 'process' && definition.command === undefined) {
      context.addIssue({ code: 'custom', message: 'Process service requires a command' });
    }
    if (
      (definition.kind === 'container' || definition.kind === 'compose') &&
      definition.containerOperation === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Container service requires a container operation',
      });
    }
  });

export type ServiceDefinition = z.infer<typeof serviceDefinitionSchema>;

export interface ServiceInstance {
  readonly instanceId: string;
  readonly serviceId: string;
  readonly ownerRunId: string;
  readonly targetId: string;
  readonly lifecycle: 'starting' | 'ready' | 'unhealthy' | 'stopped' | 'crash-loop' | 'lost';
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly restartCount: number;
  readonly processReceipt?: Readonly<Record<string, unknown>>;
  readonly containerReceipt?: Readonly<Record<string, unknown>>;
  readonly ports: readonly number[];
  readonly recentLog: string;
  readonly logTruncated: boolean;
}

export function orderServiceDefinitions(
  definitions: readonly ServiceDefinition[],
): readonly (readonly ServiceDefinition[])[] {
  const byId = new Map(definitions.map((definition) => [definition.serviceId, definition]));
  if (byId.size !== definitions.length) throw new Error('Duplicate service definition');
  const remaining = new Set(byId.keys());
  const completed = new Set<string>();
  const levels: ServiceDefinition[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((id) => byId.get(id))
      .filter((definition): definition is ServiceDefinition => definition !== undefined)
      .filter((definition) =>
        definition.dependencies.every((dependency) => completed.has(dependency)),
      );
    if (ready.length === 0) throw new Error('Service dependency cycle or unknown dependency');
    levels.push(ready);
    for (const definition of ready) {
      remaining.delete(definition.serviceId);
      completed.add(definition.serviceId);
    }
  }
  return levels;
}
