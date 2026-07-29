import { describe, expect, it } from 'vitest';

import { renderChatMarkup } from '../../src/webview/chat-markup';

describe('renderChatMarkup', () => {
  const html = renderChatMarkup({
    cspSource: 'vscode-webview://test',
    language: 'en',
    logoUri: 'vscode-webview://test/icon.png',
    nonce: 'test-nonce',
    scriptUri: 'vscode-webview://test/chat.js',
    styleUri: 'vscode-webview://test/chat.css',
    translate: (message) => message,
  });

  it('renders the workspace bar, execution spine, suggestions, and sticky composer controls', () => {
    expect(html).toContain('id="workspaceBar"');
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain('vscode-webview://test/icon.png');
    expect(html).toContain('id="conversation" class="conversation execution-spine"');
    expect(html).toContain('id="emptyState"');
    expect(html).toContain('data-prompt-kind="plan"');
    expect(html).toContain('id="modelSelect"');
    expect(html).toContain('id="agentMode"');
    expect(html).toContain('id="permissionMode"');
    expect(html).toContain('id="contextMode"');
    expect(html).toContain('id="historySelect"');
    expect(html).toContain('id="conversationTitle"');
    expect(html).toContain('aria-label="Conversation history"');
  });

  it('keeps accessible landmarks and a strict nonce-based CSP without inline handlers', () => {
    expect(html).toContain('href="#prompt"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("script-src 'nonce-test-nonce'");
    expect(html).not.toMatch(/<[^>]+\son[a-z]+=/iu);
  });
});
