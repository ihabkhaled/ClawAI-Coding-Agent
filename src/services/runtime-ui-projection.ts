import * as vscode from 'vscode';

import { type RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';

import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

type TerminalKind = 'completed' | 'failed' | 'cancelled';

interface TerminalReason {
  readonly code: string;
  readonly message: string;
}

const TERMINAL_KINDS: Readonly<Record<string, TerminalKind>> = {
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
};

function readReason(payload: Record<string, unknown>): TerminalReason | undefined {
  const reason: unknown = payload.reason;
  if (reason === null || typeof reason !== 'object') {
    return undefined;
  }
  const record = reason as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return code.length === 0 && message.length === 0 ? undefined : { code, message };
}

function describe(reason: TerminalReason | undefined): string {
  if (reason === undefined) {
    return vscode.l10n.t('The ClawAI run failed without a reported reason.');
  }
  if (reason.message.length === 0) {
    return vscode.l10n.t('The ClawAI run failed: {0}', reason.code);
  }
  if (reason.code.length === 0) {
    return reason.message;
  }
  return `${reason.message} (${reason.code})`;
}

/**
 * Turns one Runtime V2 run into what the response card shows.
 *
 * The Runtime lane used to project `model.delta` and nothing else. A run that
 * failed, completed or was cancelled told the panel nothing at all, so the card
 * kept its "Reading workspace" placeholder, the run stayed in the deck, and the
 * generation then settled and released the request binding — leaving a card
 * that could never finish. Terminalizing exactly once, and loudly when the
 * stream ends without a terminal event, is what makes that impossible.
 */
export class RuntimeUiProjector {
  private answer = '';
  private terminal: TerminalKind | undefined;
  private reason: TerminalReason | undefined;
  private settled = false;

  constructor(
    private readonly view: () => ChatViewProvider | null,
    private readonly logger: OutputLogger,
    private readonly requestId: string,
  ) {}

  project(event: RuntimeEvent): void {
    const terminal = TERMINAL_KINDS[event.type];
    if (terminal !== undefined) {
      this.terminal = terminal;
      this.reason = readReason(event.payload);
      return;
    }
    if (event.type === 'model.delta') {
      const text = typeof event.payload.text === 'string' ? event.payload.text : '';
      if (text.length === 0) {
        return;
      }
      this.answer += text;
      this.logger.info('runtime delta posted', {
        requestId: this.requestId,
        characters: text.length,
      });
      void this.view()?.postEvent({ type: 'CONTENT_DELTA', delta: text }, this.requestId);
      return;
    }
    if (event.type === 'phase.changed' && typeof event.payload.phase === 'string') {
      void this.view()?.postEvent(
        { type: 'RUNTIME_PHASE', label: event.payload.phase },
        this.requestId,
      );
    }
  }

  /** Exactly one terminal envelope per request, whatever the run did. */
  async settle(): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.logger.info('runtime run terminalized', {
      requestId: this.requestId,
      terminal: this.terminal ?? 'absent',
      characters: this.answer.length,
      ...(this.reason === undefined ? {} : { code: this.reason.code }),
    });
    if (this.terminal === 'failed') {
      await this.view()?.postError(describe(this.reason), this.requestId);
      return;
    }
    if (this.terminal === undefined) {
      await this.view()?.postError(
        vscode.l10n.t('The ClawAI run ended without reporting a result.'),
        this.requestId,
      );
      return;
    }
    await this.view()?.postResult({ content: this.content() }, this.requestId);
  }

  private content(): string {
    if (this.terminal === 'cancelled') {
      return this.answer.length === 0
        ? vscode.l10n.t('The ClawAI run was cancelled.')
        : `${this.answer}\n\n${vscode.l10n.t('The ClawAI run was cancelled.')}`;
    }
    return this.answer.length === 0
      ? vscode.l10n.t('The ClawAI run finished without producing an answer.')
      : this.answer;
  }
}
