import type { ContextCandidate, ContextReceipt } from './context-collector';

export const MAX_BACKEND_MESSAGE_BYTES = 95_000;

export interface ContextEnvelope {
  content: string;
  contextReceipt?: ContextReceipt;
}

interface ContextEnvelopeInput {
  content: string;
  context: ContextCandidate[];
  contextReceipt?: ContextReceipt;
  header: string;
  maxBytes?: number;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let length = maxBytes; length > Math.max(0, maxBytes - 4); length -= 1) {
    try {
      return decoder.decode(bytes.slice(0, length));
    } catch {
      // UTF-8 code points are at most four bytes, so the next boundary is nearby.
    }
  }
  return '';
}

function contextFileBlock(file: ContextCandidate): string {
  const path = file.path
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<workspace-file path="${path}">\n${file.content}\n</workspace-file>`;
}

export function assembleContextEnvelope(input: ContextEnvelopeInput): ContextEnvelope {
  const maxBytes = input.maxBytes ?? MAX_BACKEND_MESSAGE_BYTES;
  if (input.context.length === 0) {
    return {
      content: truncateUtf8(input.content, maxBytes),
      ...(input.contextReceipt === undefined ? {} : { contextReceipt: input.contextReceipt }),
    };
  }

  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(input.header, 'utf8'));
  let content = `${truncateUtf8(input.content, contentBudget)}${input.header}`;
  const included: string[] = [];
  const excluded = [...(input.contextReceipt?.excluded ?? [])];
  let totalBytes = 0;
  let transportTruncated = false;

  for (const file of input.context) {
    const separator = included.length === 0 ? '\n' : '\n\n';
    const block = `${separator}${contextFileBlock(file)}`;
    if (Buffer.byteLength(content, 'utf8') + Buffer.byteLength(block, 'utf8') > maxBytes) {
      excluded.push({ path: file.path, reason: 'limit' });
      transportTruncated = true;
      continue;
    }
    content += block;
    included.push(file.path);
    totalBytes += Buffer.byteLength(file.content, 'utf8');
  }

  return {
    content,
    contextReceipt: {
      excluded,
      included,
      totalBytes,
      truncated: (input.contextReceipt?.truncated ?? false) || transportTruncated,
    },
  };
}
