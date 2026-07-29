import { describe, expect, it } from 'vitest';

import { createChatSession, deriveConversationSubject } from '../../src/core/chat-session';

describe('chat sessions', () => {
  it('derives a concise subject from the first prompt', () => {
    expect(deriveConversationSubject('create a file for loop .js in apps folder')).toBe(
      'Create a file for loop .js',
    );
    expect(deriveConversationSubject('   audit   workspace\nand report failures   ')).toBe(
      'Audit workspace and report failures',
    );
  });

  it('creates an isolated editor session descriptor', () => {
    expect(createChatSession('session-1', 42)).toEqual({
      createdAt: 42,
      sessionId: 'session-1',
      subject: 'New ClawAI chat',
      threadId: undefined,
      updatedAt: 42,
    });
  });
});

