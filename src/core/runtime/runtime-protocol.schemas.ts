import { z } from 'zod';

import {
  RUNTIME_EVENT_SENSITIVITIES,
  RUNTIME_EVENT_TYPE_PATTERN,
  RUNTIME_EVENT_VISIBILITIES,
  RUNTIME_ID_PATTERN,
  RUNTIME_PROTOCOL_V2,
  RUNTIME_PROTOCOL_VERSIONS,
  RUNTIME_TRANSPORTS,
  SHA256_PATTERN,
} from './runtime-protocol.constants';

const runtimeFeaturesSchema = z
  .object({
    capabilityManifest: z.boolean(),
    orderedRunEvents: z.boolean(),
    toolExecution: z.boolean(),
  })
  .strict();

const runtimeLimitsSchema = z
  .object({
    maxEventBytes: z.number().int().min(1_024).max(16_777_216),
    maxActiveRuns: z.number().int().min(1).max(256),
  })
  .strict();

export const runtimeProtocolDescriptorSchema = z
  .object({
    versions: z.array(z.enum(RUNTIME_PROTOCOL_VERSIONS)).min(1).max(2),
    preferred: z.enum(RUNTIME_PROTOCOL_VERSIONS),
    transports: z.array(z.enum(RUNTIME_TRANSPORTS)).min(1).max(1),
    features: runtimeFeaturesSchema,
    limits: runtimeLimitsSchema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (!descriptor.versions.includes(descriptor.preferred)) {
      context.addIssue({
        code: 'custom',
        message: 'Preferred protocol version must be included in supported versions',
        path: ['preferred'],
      });
    }
    if (new Set(descriptor.versions).size !== descriptor.versions.length) {
      context.addIssue({
        code: 'custom',
        message: 'Supported protocol versions must be unique',
        path: ['versions'],
      });
    }
  });

const runtimeEpochsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
  })
  .strict();

const runtimeCorrelationSchema = z
  .object({
    requestId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    invocationId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    taskId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    parentEventId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    causationId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
  })
  .strict();

export const runtimeEventSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    eventId: z.string().regex(RUNTIME_ID_PATTERN),
    runId: z.string().regex(RUNTIME_ID_PATTERN),
    agentId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    turnId: z.string().regex(RUNTIME_ID_PATTERN).nullable().optional(),
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime({ offset: true }),
    type: z.string().min(3).max(120).regex(RUNTIME_EVENT_TYPE_PATTERN),
    visibility: z.enum(RUNTIME_EVENT_VISIBILITIES),
    sensitivity: z.enum(RUNTIME_EVENT_SENSITIVITIES),
    epochs: runtimeEpochsSchema,
    payload: z.record(z.string(), z.unknown()),
    correlation: runtimeCorrelationSchema.optional(),
    contentHash: z.string().regex(SHA256_PATTERN).optional(),
  })
  .strict();

export type RuntimeProtocolDescriptor = z.infer<typeof runtimeProtocolDescriptorSchema>;
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

export function parseRuntimeProtocolDescriptor(value: unknown): RuntimeProtocolDescriptor {
  return runtimeProtocolDescriptorSchema.parse(value);
}

export function parseRuntimeEvent(value: unknown): RuntimeEvent {
  return runtimeEventSchema.parse(value);
}
