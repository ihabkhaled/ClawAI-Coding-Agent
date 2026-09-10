import { z } from 'zod';

import { chatAttachmentsSchema } from '../core/chat-attachment';
import { effortModeSchema } from '../core/effort-mode';
import { RESEARCH_MODES } from '../core/research-mode';
import { speedModeSchema } from '../core/speed-mode';

import type { ContextMode } from '../core/context-mode';

const contextModeSchema: z.ZodType<ContextMode> = z.enum([
  'file',
  'none',
  'selection',
  'smart',
  'workspace',
]);
const researchModeSchema = z.enum(RESEARCH_MODES).default('NONE');
const selectableEnvironmentSchema = z.enum(['LOCAL', 'CLOUD', 'CUSTOM']);
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
  z.object({ type: z.literal('runtimePause') }),
  z.object({ type: z.literal('runtimeResume') }),
  z.object({ type: z.literal('runtimeStop') }),
  z.object({ type: z.literal('runtimeSteer'), message: z.string().trim().min(1).max(20_000) }),
  z.object({ type: z.literal('undo') }),
  z.object({
    type: z.literal('mentionQuery'),
    text: z.string().max(20_000),
    caretIndex: z.number().int().min(0).max(20_000),
  }),
  // The panel is the only place that knows a conversation's running token
  // total, so it reports the number; the host decides what it means. The
  // capacity is not sent with it, because the host can derive that from the
  // catalog and a number the host owns is one it should not accept from here.
  z.object({
    type: z.literal('conversationTokens'),
    threadId: z.string().min(1).max(200),
    tokens: z.number().int().min(0).max(100_000_000),
  }),
  // The panel forwards the drag payload rather than resolving it: only the
  // host knows the workspace root, and only the host owns the path policy that
  // decides whether a dropped URI may be read at all.
  z.object({
    type: z.literal('dropUris'),
    uriList: z.string().max(20_000),
    shiftKey: z.boolean(),
  }),
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
  // The selection is deliberately loose here and validated against the question
  // that was actually asked, in `resolveQuestionAnswer`. A shape check alone
  // would happily pass a label from a previous question.
  z.object({
    type: z.literal('answerQuestion'),
    requestId: z.uuid(),
    selection: z.unknown(),
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
    type: z.literal('selectViewDensity'),
    density: z.enum(['full', 'focus']),
  }),
  z.object({
    type: z.literal('selectAgentMode'),
    mode: z.enum(['AUTO', 'PLAN']),
  }),
  z.object({
    type: z.literal('selectEffortMode'),
    mode: effortModeSchema,
  }),
  z.object({
    type: z.literal('selectSpeedMode'),
    mode: speedModeSchema,
  }),
  z.object({
    type: z.literal('selectPermissionMode'),
    mode: z.enum(['PLAN', 'ASK', 'AUTO_EDIT', 'AUTONOMOUS_SCOPED', 'ENTERPRISE_LOCKED']),
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
