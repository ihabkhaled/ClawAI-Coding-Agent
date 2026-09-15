import { describe, expect, it } from 'vitest';

import { renderTranscriptExport, transcriptExportFilename } from '../../src/core/transcript-export';

import type { TranscriptMessage } from '../../src/core/transcript-export';

const exportedAt = Date.UTC(2026, 8, 8, 13, 0, 0);

function message(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return { role: 'user', content: 'Why does the redirect loop?', ...overrides };
}

const base = {
  title: 'Fix the login redirect',
  threadId: 'thread-1',
  exportedAt,
} as const;

describe('renderTranscriptExport', () => {
  it('writes a readable Markdown record naming each speaker', () => {
    const output = renderTranscriptExport({
      ...base,
      format: 'markdown',
      messages: [
        message(),
        message({
          role: 'assistant',
          content: 'The cookie is unset.',
          provider: 'ANTHROPIC',
          model: 'claude-sonnet',
        }),
      ],
    });

    expect(output).toContain('# Fix the login redirect');
    expect(output).toContain('## You');
    expect(output).toContain('## ClawAI · ANTHROPIC claude-sonnet');
    expect(output).toContain('The cookie is unset.');
    expect(output).toContain('2026-09-08T13:00:00.000Z');
  });

  it('writes machine-readable JSON carrying attribution and token counts', () => {
    const output = renderTranscriptExport({
      ...base,
      format: 'json',
      messages: [
        message({ role: 'assistant', model: 'claude-sonnet', inputTokens: 12, outputTokens: 34 }),
      ],
    });
    const parsed: unknown = JSON.parse(output);

    expect(parsed).toMatchObject({
      title: 'Fix the login redirect',
      threadId: 'thread-1',
      messages: [{ role: 'assistant', model: 'claude-sonnet', inputTokens: 12, outputTokens: 34 }],
    });
  });

  // An export leaves the extension the moment it is written. A transcript is
  // the likeliest place for a token to sit, because a user pastes one in to ask
  // why a request failed.
  it.each(['markdown', 'json'] as const)('redacts credentials in %s', (format) => {
    const output = renderTranscriptExport({
      ...base,
      format,
      messages: [
        message({ content: 'It fails with Authorization: Bearer abc123SECRETVALUE every call' }),
        message({ content: 'curl -H "api_key=xyz789SECRET" /v1/me' }),
      ],
    });

    expect(output).not.toContain('abc123SECRETVALUE');
    expect(output).not.toContain('xyz789SECRET');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts a credential hiding in the title', () => {
    const output = renderTranscriptExport({
      ...base,
      title: 'debug password=hunter2ACTUAL',
      format: 'markdown',
      messages: [message()],
    });

    expect(output).not.toContain('hunter2ACTUAL');
  });

  it('names an unknown role rather than guessing it is the assistant', () => {
    const output = renderTranscriptExport({
      ...base,
      format: 'markdown',
      messages: [message({ role: 'system', content: 'Tool result' })],
    });

    expect(output).toContain('## system');
  });
});

describe('transcriptExportFilename', () => {
  it('names the file after the conversation and the moment it was taken', () => {
    expect(transcriptExportFilename('Fix the login redirect', 'markdown', exportedAt)).toBe(
      'fix-the-login-redirect-2026-09-08T13-00-00-000Z.md',
    );
    expect(transcriptExportFilename('Fix it', 'json', exportedAt)).toMatch(/\.json$/u);
  });

  // The title is user and model text, so it cannot be trusted into a path.
  it('refuses separators, traversal and reserved characters', () => {
    const name = transcriptExportFilename('../../etc/passwd: <CON>|', 'markdown', exportedAt);

    expect(name).not.toMatch(/[/\\:<>|]/u);
    expect(name).not.toContain('..');
  });

  it('falls back to a usable name when the title reduces to nothing', () => {
    expect(transcriptExportFilename('…', 'markdown', exportedAt)).toMatch(/^clawai-chat-/u);
  });
});
