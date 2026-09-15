import { parseDeepLink } from '../core/deep-link';

import type * as vscode from 'vscode';

export interface DeepLinkNavigationPort {
  openChat(threadId?: string): Promise<unknown>;
}

/**
 * Handles `vscode://clawai.clawai-coding-agent/...` links.
 *
 * Deliberately tiny. Per `docs/adr/0001-uri-handler-navigation-only.md` this
 * opens a view or a conversation and does nothing else: no credential passes
 * through it, no prompt text comes from it, and no side effect follows from the
 * link alone. Authorization keeps using the loopback callback described in
 * `docs/AUTHENTICATION.md`, which this decision does not touch.
 */
export class ClawaiUriHandler implements vscode.UriHandler {
  constructor(private readonly navigation: DeepLinkNavigationPort) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const request = parseDeepLink(uri.path, uri.query);
    if (request === undefined) return;
    // `openChat` with no thread opens the view; with one it reveals that
    // conversation. Either way the backend decides whether the thread belongs
    // to the signed-in account, so a guessed id reveals nothing.
    await this.navigation.openChat(request.kind === 'session' ? request.threadId : undefined);
  }
}
