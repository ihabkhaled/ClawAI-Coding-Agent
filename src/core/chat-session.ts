import type { TokenReceipt } from './token-telemetry';

const DEFAULT_SUBJECT = 'New ClawAI chat';
const MAX_SUBJECT_LENGTH = 48;
const LOCATION_WORDS = new Set(['at', 'in', 'inside', 'under']);

export type TranscriptEntryKind =
  | 'approval'
  | 'assistant'
  | 'command'
  | 'error'
  | 'file'
  | 'progress'
  | 'summary'
  | 'user';

export type TranscriptEntryStatus = 'completed' | 'failed' | 'pending' | 'running';

export interface TranscriptEntry {
  content: string;
  createdAt: number;
  id: string;
  kind: TranscriptEntryKind;
  requestId?: string;
  status?: TranscriptEntryStatus;
  title?: string;
  tokens?: TokenReceipt;
}

export interface ChatSessionDescriptor {
  createdAt: number;
  sessionId: string;
  subject: string;
  threadId: string | undefined;
  updatedAt: number;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const candidate = value.slice(0, maxLength + 1);
  const boundary = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, boundary > 0 ? boundary : maxLength).trimEnd()}…`;
}

function omitLocation(words: string[]): string[] {
  if (words.length < 7) {
    return words;
  }
  const locationIndex = words.findIndex(
    (word, index) => index >= 4 && LOCATION_WORDS.has(word.toLowerCase()),
  );
  return locationIndex === -1 ? words : words.slice(0, locationIndex);
}

export function deriveConversationSubject(prompt: string): string {
  const normalized = prompt.replaceAll(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return DEFAULT_SUBJECT;
  }
  const sentence = normalized.split(/[.!?](?:\s|$)/u, 1)[0] ?? normalized;
  const subject = omitLocation(sentence.split(' ')).join(' ');
  return capitalize(truncateAtWord(subject, MAX_SUBJECT_LENGTH));
}

export function createChatSession(sessionId: string, now = Date.now()): ChatSessionDescriptor {
  return {
    createdAt: now,
    sessionId,
    subject: DEFAULT_SUBJECT,
    threadId: undefined,
    updatedAt: now,
  };
}
