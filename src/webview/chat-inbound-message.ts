import { z } from 'zod';

import { chatAttachmentsSchema } from '../core/chat-attachment';
import { RESEARCH_MODES } from '../core/research-mode';

import type { ContextMode } from '../core/context-mode';

const contextModeSchema: z.ZodType<ContextMode> = z.enum([
  'file',
  'none',
  'selection',
  'smart',
  'workspace',
]);
const researchModeSchema = z.enum(RESEARCH_MODES).default('NONE');
const selectableEnvironmentSchema = z.enum(['LOCAL', 'CUSTOM']);
const connectionProfileSchema = z.object({
  backendEnvironment: selectableEnvironmentSchema,
  backendCustomUrl: z.string().trim().max(2_000),
  frontendEnvironment: selectableEnvironmentSchema,
  frontendCustomUrl: z.string().trim().max(2_000),
});

export const inboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z
    .object({
      type: z.literal('connect'),
    })
    .extend(connectionProfileSchema.shape),
  z.object({ type: z.literal('configureConnections') }).extend(connectionProfileSchema.shape),
  z.object({ type: z.literal('logout') }),
  z.object({ type: z.literal('cancel'), requestId: z.uuid().optional() }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newChat') }),
  z.object({ type: z.literal('openFolder') }),
  z.object({ type: z.literal('refreshModels') }),
  z.object({ type: z.literal('configureLanguage') }),
  z.object({ type: z.literal('manageExternalOutputFolders') }),
  z.object({
    type: z.literal('reviewChanges'),
    previewId: z.uuid().optional(),
  }),
  z.object({
    type: z.literal('selectHistory'),
    threadId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('removeQueued'),
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal('resolveApproval'),
    requestId: z.uuid(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal('agent'),
    attachments: chatAttachmentsSchema.default([]),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    modelKey: z.string().min(1).max(500),
    researchMode: researchModeSchema,
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal('send'),
    attachments: chatAttachmentsSchema.default([]),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    modelKey: z.string().min(1).max(500),
    researchMode: researchModeSchema,
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal('compare'),
    attachments: chatAttachmentsSchema.default([]),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    modelKeys: z.array(z.string().min(1).max(500)).min(2).max(5),
    researchMode: researchModeSchema,
    judgeEnabled: z.boolean(),
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal('selectModel'),
    modelKey: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('selectAgentMode'),
    mode: z.enum(['AUTO', 'PLAN']),
  }),
  z.object({
    type: z.literal('selectPermissionMode'),
    mode: z.enum(['BYPASS_PERMISSIONS', 'EDIT_AUTOMATICALLY', 'MANUAL']),
  }),
  z.object({
    type: z.literal('selectWorkspaceFolder'),
    folderKey: z.string().min(1).max(100),
  }),
]);

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type PromptMessage = Extract<InboundMessage, { type: 'agent' | 'compare' | 'send' }>;
export type ControlMessage = Exclude<InboundMessage, PromptMessage | { type: 'ready' }>;

const promptRequestEnvelopeSchema = z
  .object({
    type: z.enum(['agent', 'compare', 'send']),
    requestId: z.uuid(),
  })
  .loose();

export function promptRequestId(message: unknown): string | undefined {
  const parsed = promptRequestEnvelopeSchema.safeParse(message);
  return parsed.success ? parsed.data.requestId : undefined;
}
