import { describe, expect, it } from 'vitest';

import {
  BACKEND_CLOUD_URL,
  BACKEND_LOCAL_URL,
  FRONTEND_CLOUD_URL,
} from '../../src/core/configuration';
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
    expect(html).toContain('id="effortMode"');
    expect(html).toContain('id="speedMode"');
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
    expect(html).toContain('id="connectionSettingsButton"');
    expect(html).toContain('id="connectButton"');
    expect(html).toContain('id="authenticatedUi"');
    expect(html).toContain('id="approvalReview"');
  });

  it('offers every cloud radio as a selectable lane labelled with its real origin', () => {
    for (const id of [
      'backendEnvironmentCloud',
      'frontendEnvironmentCloud',
      'settingsBackendCloud',
      'settingsFrontendCloud',
    ]) {
      const radio = new RegExp(`<input id="${id}"[^>]*>`, 'iu').exec(html)?.[0];
      expect(radio, `${id} is missing from the markup`).toBeDefined();
      expect(radio).toContain('value="CLOUD"');
      expect(radio).not.toContain('disabled');
    }
    expect(html).not.toContain('environment-disabled');
    expect(html).not.toContain('Coming soon');
  });

  it('prints resolver origins so the gate cannot drift from what it connects to', () => {
    expect(html).toContain(`<small>${BACKEND_CLOUD_URL}</small>`);
    expect(html).toContain(`<small>${FRONTEND_CLOUD_URL}</small>`);
    expect(html).toContain(`<small>${BACKEND_LOCAL_URL}</small>`);
    expect(html).toContain(`placeholder="${BACKEND_LOCAL_URL}"`);
  });

  it('keeps model, run and effort on the composer rail and the rest one click away', () => {
    const rail =
      /<div class="control-rail primary-control-rail">([\s\S]*?)<details id="moreSettings"/u.exec(
        html,
      )?.[1];
    expect(rail, 'primary control rail is missing').toBeDefined();
    for (const id of ['modelSelect', 'runMode', 'effortMode']) {
      expect(rail).toContain(`id="${id}"`);
    }
    const popover = /<div class="secondary-controls">([\s\S]*?)<\/details>/u.exec(html)?.[1];
    expect(popover, 'settings popover is missing').toBeDefined();
    for (const id of ['agentMode', 'speedMode', 'permissionMode', 'contextMode', 'researchMode']) {
      expect(popover).toContain(`id="${id}"`);
    }
    expect(popover).not.toContain('id="effortMode"');
  });

  it('sends with a labelled stroke icon rather than a font glyph', () => {
    const send = /<button id="sendButton"[\s\S]*?<\/button>/u.exec(html)?.[0];
    expect(send, 'send button is missing').toBeDefined();
    expect(send).toContain('aria-label="Send message"');
    expect(send).toContain('title="Send · Ctrl/⌘ + Enter"');
    expect(send).toContain('id="sendButtonLabel"');
    expect(send).toContain('<svg class="claw-icon"');
    expect(send).not.toContain('↑');
  });

  it('offers a theme control and a collapsible header menu', () => {
    expect(html).toContain('id="themeMode"');
    expect(html).toContain('value="system"');
    expect(html).toContain('id="workspaceMenu"');
    expect(html).toContain('id="workspaceMenuToggle"');
    expect(html).toContain('aria-controls="workspaceMenu"');
    expect(html).toContain('aria-label="More actions"');
  });

  it('ships the strings the webview needs for dismissible warnings and refresh feedback', () => {
    for (const attribute of [
      'data-dismiss="Dismiss"',
      'data-dont-show-again="Don\'t show again"',
      'data-refreshing-models="Refreshing models…"',
      'data-models-refreshed="Model list updated"',
    ]) {
      expect(html).toContain(attribute);
    }
  });

  it('gives every one-line control a title so nothing is silently clipped', () => {
    for (const id of [
      'historySelect',
      'modelSelect',
      'runMode',
      'effortMode',
      'agentMode',
      'speedMode',
      'permissionMode',
      'contextMode',
      'researchMode',
      'themeMode',
    ]) {
      const select = new RegExp(`<select id="${id}"[^>]*>`, 'u').exec(html)?.[0];
      expect(select, `${id} is missing from the markup`).toBeDefined();
      expect(select, `${id} has no title`).toMatch(/title="[^"]+"/u);
    }
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
