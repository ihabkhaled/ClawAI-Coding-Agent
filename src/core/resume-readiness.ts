import { ACTIVE_ELSEWHERE_WINDOW_MS } from './resume-readiness.constants';

interface TranscriptEntry {
  readonly role: string;
  readonly createdAt?: string | Date | undefined;
}

function timeOf(entry: TranscriptEntry): number {
  return entry.createdAt === undefined ? Number.NaN : new Date(entry.createdAt).getTime();
}

/**
 * The newest message, by timestamp. `GET /chat-messages/thread/:id` returns
 * newest first, so the first entry is the fallback when timestamps are absent;
 * order is not trusted beyond that because it is a server detail.
 */
function newestOf(messages: readonly TranscriptEntry[]): TranscriptEntry | undefined {
  let newest = messages[0];
  for (const entry of messages) {
    if (newest !== undefined && timeOf(entry) > timeOf(newest)) {
      newest = entry;
    }
  }
  return newest;
}

/**
 * Whether the thread's last run may still be generating on another surface.
 *
 * The chat API exposes no "active run for thread" read, so this is decided
 * from the transcript: the newest message is the user's prompt, no reply has
 * landed, and the prompt is recent. A prompt with no readable timestamp counts
 * as recent — guessing "finished" and posting on top of a live run is the
 * worse of the two mistakes.
 */
export function isRunActiveElsewhere(
  messages: readonly TranscriptEntry[],
  now: number = Date.now(),
): boolean {
  const newest = newestOf(messages);
  if (newest?.role.toUpperCase() !== 'USER') {
    return false;
  }
  const sentAt = timeOf(newest);
  return Number.isNaN(sentAt) || now - sentAt < ACTIVE_ELSEWHERE_WINDOW_MS;
}
