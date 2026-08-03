import type { ChatMessage } from '../backend/contracts';

export function publicHistoryMessage(message: ChatMessage) {
  return {
    content: message.content,
    createdAt:
      message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
    id: message.id,
    inputTokens: message.inputTokens,
    latencyMs: message.latencyMs,
    model: message.model,
    modelDisplayName: message.metadata?.modelDisplayName,
    outputTokens: message.outputTokens,
    provider: message.provider,
    role: message.role,
    status: message.status,
  };
}
