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

  it('renders the Signal Desk run region, token meter, and progressive composer controls', () => {
    expect(html).toContain('id="workspaceBar"');
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain('vscode-webview://test/icon.png');
    expect(html).toContain('id="conversationTokenMeter"');
    expect(html).toContain('id="languageButton"');
    expect(html).toContain('aria-label="Change display language"');
    expect(html).toContain('Current model');
    expect(html).toContain('Context used');
    expect(html).toContain('Agent behavior');
    expect(html).not.toContain('<dt>Plan</dt>');
    expect(html).toContain('id="runDeck"');
    expect(html).toContain('id="runDeckCount"');
    expect(html).toContain('id="activeRunList"');
    expect(html).toContain('id="waitingRunList"');
    expect(html).toContain('aria-label="Runs"');
    expect(html).toContain('id="conversation" class="conversation execution-spine"');
    expect(html).toContain('id="emptyState"');
    expect(html).toContain('data-prompt-kind="plan"');
    expect(html).toContain('id="modelSelect"');
    expect(html).toContain('<details id="moreSettings"');
    expect(html).toContain('id="moreSettingsSummary"');
    expect(html).toContain('id="agentMode"');
    expect(html).toContain('id="permissionMode"');
    expect(html).toContain('id="contextMode"');
    expect(html).toContain('id="researchMode"');
    expect(html).toContain('id="externalOutputButton"');
    expect(html).toContain('value="NONE"');
    expect(html).toContain('id="selectedModelStrip"');
    expect(html).toContain('id="historySelect"');
    expect(html).toContain('id="conversationTitle"');
    expect(html).toContain('aria-label="Conversation history"');
    expect(html).toContain('id="connectionGate"');
    expect(html).toContain('id="backendUrlInput"');
    expect(html).toContain('name="backendEnvironment"');
    expect(html).toContain('name="frontendEnvironment"');
    expect(html).toContain('id="backendEnvironmentCloud"');
    expect(html).toContain('id="frontendEnvironmentCloud"');
    expect(html).toMatch(/id="backendEnvironmentCloud"[^>]*disabled/iu);
    expect(html).toMatch(/id="frontendEnvironmentCloud"[^>]*disabled/iu);
    expect(html).toContain('Coming soon');
    expect(html).toContain('id="connectionSettingsButton"');
    expect(html).toContain('id="connectButton"');
    expect(html).toContain('id="authenticatedUi"');
    expect(html).toContain('id="approvalReview"');
  });

  it('keeps accessible landmarks and a strict nonce-based CSP without inline handlers', () => {
    expect(html).toContain('href="#backendUrlInput"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).not.toContain('id="conversation" class="conversation execution-spine" aria-live');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("script-src 'nonce-test-nonce'");
    expect(html).not.toMatch(/<[^>]+\son[a-z]+=/iu);
  });
});
