import { z } from 'zod';

import { tokenPairSchema } from '../core/session-vault';

export const authUserSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    username: z.string(),
    role: z.string(),
    permissions: z.array(z.string()),
    mustChangePassword: z.boolean(),
    languagePreference: z.string(),
    appearancePreference: z.string(),
  })
  .loose();

export const refreshResultSchema = z.object({
  tokens: tokenPairSchema,
});

export const vscodeAuthorizationInitResultSchema = z.object({
  authorizationPath: z.string().startsWith('/'),
  expiresIn: z.number().int().positive(),
  requestId: z.string().min(32),
});

export const userProfileSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    username: z.string(),
    role: z.string(),
    permissions: z.array(z.string()),
    mustChangePassword: z.boolean(),
    languagePreference: z.string(),
    appearancePreference: z.string(),
  })
  .loose();

export const routerModelSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    modelKey: z.string(),
    displayName: z.string(),
    isLocal: z.boolean(),
    isExecutionCapable: z.boolean(),
    lifecycle: z.string(),
    supportsStreaming: z.boolean().nullable().optional(),
    supportsTools: z.boolean().nullable().optional(),
    supportsStructuredOutput: z.boolean().nullable().optional(),
    supportsVision: z.boolean().nullable().optional(),
    contextWindowTokens: z.number().int().nullable().optional(),
    maxContextTokens: z.number().int().nullable().optional(),
  })
  .loose();

export const connectorModelSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    provider: z.string(),
    modelKey: z.string(),
    displayName: z.string(),
    lifecycle: z.string(),
    supportsStreaming: z.boolean(),
    supportsTools: z.boolean(),
    supportsVision: z.boolean(),
    supportsAudio: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    maxContextTokens: z.number().int().nullable(),
  })
  .loose();

export const localOllamaModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tag: z.string(),
    family: z.string().nullable(),
    isInstalled: z.boolean(),
  })
  .loose();

export const localFrontierModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tag: z.string(),
    displayName: z.string(),
    parameterCount: z.string(),
    contextLength: z.number().int().positive(),
    downloadStatus: z.string(),
  })
  .loose();

export const localFrontierListSchema = z.object({
  data: z.array(localFrontierModelSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const paginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  });
}

export const threadSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    routingMode: z.string().optional(),
    preferredProvider: z.string().nullable().optional(),
    preferredModel: z.string().nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
    updatedAt: z.union([z.string(), z.date()]).optional(),
    _count: z
      .object({
        messages: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .loose();

export const messageSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    role: z.string(),
    content: z.string(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    inputTokens: z.number().int().nullable().optional(),
    outputTokens: z.number().int().nullable().optional(),
    latencyMs: z.number().int().nullable().optional(),
    status: z.string().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .loose();

export const uploadedFileSchema = z
  .object({
    id: z.string().min(1),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .loose();

export const parallelModelResponseSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    content: z.string(),
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    status: z.enum(['completed', 'failed', 'timeout']),
    errorMessage: z.string().nullable(),
    judgeReview: z.unknown().nullable().optional(),
  })
  .loose();

export const parallelResponseSchema = z
  .object({
    messageId: z.string(),
    threadId: z.string(),
    prompt: z.string(),
    responses: z.array(parallelModelResponseSchema).min(2).max(5),
    totalLatencyMs: z.number().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    judgeEnabled: z.boolean(),
    judgeModel: z.string().nullable(),
  })
  .loose();

export const entitlementsSchema = z
  .object({
    userId: z.string(),
    role: z.string(),
    isAdmin: z.boolean(),
    permissions: z.array(z.string()),
    plan: z
      .object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        featureGates: z.record(z.string(), z.unknown()),
      })
      .nullable(),
    allowedModels: z.array(
      z
        .object({
          provider: z.string(),
          model: z.string(),
          isAllowed: z.boolean(),
          allowAsPrimary: z.boolean(),
          allowAsFallback: z.boolean(),
          allowAsJudge: z.boolean(),
          allowInCompare: z.boolean(),
          dailyTokenLimitOverride: z.number().nullable(),
        })
        .loose(),
    ),
    allowedProviders: z.array(z.string()),
    quota: z.object({
      dailyLimit: z.number(),
      used: z.number(),
      remaining: z.number(),
      unlimited: z.boolean(),
    }),
  })
  .loose();

const usageWindowSchema = z.object({
  used: z.number(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  periodKey: z.string(),
});

export const usageSchema = z
  .object({
    day: usageWindowSchema,
    week: usageWindowSchema,
    month: usageWindowSchema,
    features: z.array(
      z
        .object({
          feature: z.string(),
          allowed: z.boolean(),
          limit: z.number().nullable(),
          used: z.number(),
          remaining: z.number().nullable(),
          window: z.string().nullable(),
        })
        .loose(),
    ),
  })
  .loose();

export type AuthUser = z.infer<typeof authUserSchema>;
export type RouterModel = z.infer<typeof routerModelSchema>;
export type ConnectorModel = z.infer<typeof connectorModelSchema>;
export type LocalOllamaModel = z.infer<typeof localOllamaModelSchema>;
export type LocalFrontierModel = z.infer<typeof localFrontierModelSchema>;
export type ChatThread = z.infer<typeof threadSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type UploadedFile = z.infer<typeof uploadedFileSchema>;
export type ParallelResponse = z.infer<typeof parallelResponseSchema>;
export type Entitlements = z.infer<typeof entitlementsSchema>;
export type Usage = z.infer<typeof usageSchema>;
