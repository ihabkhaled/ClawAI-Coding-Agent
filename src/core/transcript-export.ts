import { redactText } from './redaction';

export const TRANSCRIPT_EXPORT_FORMATS = ['markdown', 'json'] as const;

export type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_FORMATS)[number];

/**
 * One turn, in the shape this module needs rather than the shape it arrives in.
 *
 * The live transcript is the backend's `ChatMessage`, but `src/core` does not
 * import `src/backend`, so the service maps into this on the way out. Note that
 * `TranscriptEntry` in `chat-session.ts` is NOT the source: it is a declared
 * type with no producers and no consumers, and exporting from it would have
 * meant inventing the data it describes.
 */
export interface TranscriptMessage {
  readonly role: string;
  readonly content: string;
  readonly model?: string;
  readonly provider?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface TranscriptExportInput {
  readonly title: string;
  readonly threadId: string;
  readonly messages: readonly TranscriptMessage[];
  readonly format: TranscriptExportFormat;
  readonly exportedAt: number;
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}

/**
 * Every exported string goes through `redactText`.
 *
 * An export leaves the extension's control the moment it is written — it is
 * attached to a bug report, pasted into a chat, committed by accident. A
 * transcript is the likeliest place for a token to be sitting, because a user
 * pastes one in to ask why a request failed. Redacting at this boundary rather
 * than trusting each producer means a future field cannot leak by omission.
 */
function safe(value: string): string {
  return redactText(value);
}

function speaker(role: string): string {
  if (role.toLowerCase() === 'user') return 'You';
  if (role.toLowerCase() === 'assistant') return 'ClawAI';
  return safe(role);
}

function attribution(message: TranscriptMessage): string {
  const parts = [message.provider, message.model].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length === 0 ? '' : ` · ${safe(parts.join(' '))}`;
}

function markdown(input: TranscriptExportInput): string {
  const lines = [
    `# ${safe(input.title)}`,
    '',
    `Exported ${timestamp(input.exportedAt)} from ClawAI Coding Agent.`,
    '',
    'Secrets are redacted. This is a record of the conversation, not a',
    'substitute for the run journal or the evidence bundle.',
    '',
  ];
  for (const message of input.messages) {
    lines.push(`## ${speaker(message.role)}${attribution(message)}`, '', safe(message.content), '');
  }
  return lines.join('\n');
}

function json(input: TranscriptExportInput): string {
  return `${JSON.stringify(
    {
      title: safe(input.title),
      threadId: input.threadId,
      exportedAt: timestamp(input.exportedAt),
      messages: input.messages.map((message) => ({
        role: message.role,
        content: safe(message.content),
        ...(message.provider === undefined ? {} : { provider: safe(message.provider) }),
        ...(message.model === undefined ? {} : { model: safe(message.model) }),
        // Counts are numbers about a conversation, not content from it, and are
        // the first thing anyone asks of a transcript.
        ...(message.inputTokens === undefined ? {} : { inputTokens: message.inputTokens }),
        ...(message.outputTokens === undefined ? {} : { outputTokens: message.outputTokens }),
      })),
    },
    null,
    2,
  )}\n`;
}

export function renderTranscriptExport(input: TranscriptExportInput): string {
  return input.format === 'json' ? json(input) : markdown(input);
}

/**
 * A filename that is safe on every supported host and says what it holds.
 *
 * The title is user and model text, so it cannot be trusted into a path. It is
 * reduced to word characters, which also removes the separators, reserved
 * characters, device names and trailing dots that Windows refuses.
 */
export function transcriptExportFilename(
  title: string,
  format: TranscriptExportFormat,
  exportedAt: number,
): string {
  const slug =
    title
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60) || 'clawai-chat';
  const stamp = timestamp(exportedAt).replaceAll(/[:.]/gu, '-');
  return `${slug}-${stamp}.${format === 'json' ? 'json' : 'md'}`;
}
