import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { applyTerminalInput, EMPTY_LINE } from '../core/terminal-line-editor';
import { toTerminalSafeText } from '../core/terminal-output';
import { describeRunChange, isRunFinished } from '../core/terminal-run-report';

import type { AgentTerminalPort, AgentTerminalStatePort } from './agent-terminal.types';
import type { AgentRunPhase, AgentRunSnapshot } from '../core/agent-run';
import type { TerminalLineState } from '../core/terminal-line-editor.types';
import type { TerminalRunLine } from '../core/terminal-run-report.types';

const PROMPT = '\r\nclawai> ';
/**
 * The terminal's name is the product name, so it is a constant rather than a
 * translated string. Routing a brand through `l10n.t` produces an entry that is
 * identical in all thirteen locales, which the localisation ratchet correctly
 * reports as an untranslated message.
 */
const TERMINAL_NAME = 'ClawAI';

function phaseLabel(phase: AgentRunPhase): string {
  const labels: Record<AgentRunPhase, string> = {
    applied: vscode.l10n.t('Applied file changes'),
    executing: vscode.l10n.t('Running development commands'),
    failed: vscode.l10n.t('Coding run failed'),
    generating: vscode.l10n.t('Generating edit plan'),
    planned: vscode.l10n.t('Plan ready'),
    reading: vscode.l10n.t('Reading workspace'),
    rejected: vscode.l10n.t('Changes rejected'),
    repairing: vscode.l10n.t('Repairing model response'),
    reviewing: vscode.l10n.t('Reviewing file changes'),
    validating: vscode.l10n.t('Validating edit plan'),
    verified: vscode.l10n.t('Verified workspace changes'),
  };
  return labels[phase];
}

function renderLine(line: TerminalRunLine): string {
  if (line.kind === 'phase') {
    return `  ${phaseLabel(line.phase)}`;
  }
  if (line.kind === 'file') {
    return `  ${line.operation} ${line.path}`;
  }
  if (line.kind === 'command') {
    return `  $ ${line.command}`;
  }
  return toTerminalSafeText(line.text).text;
}

/**
 * A ClawAI conversation hosted by a terminal instead of by the panel.
 *
 * The panel is the right home for an answer with code in it. A run is a
 * different thing: a sequence of phases, files and commands that reads like a
 * build log and belongs where build logs go. Nothing about the run pipeline
 * changes to support this — the terminal subscribes to the same run snapshots
 * the panel does and prints what changed, so the two surfaces cannot disagree
 * about what a run did.
 *
 * Everything the model contributes goes through `toTerminalSafeText` first. A
 * pseudoterminal renders whatever it is handed, and a summary written straight
 * from the wire would hand the model the cursor.
 */
export class AgentTerminal implements vscode.Pseudoterminal {
  private readonly writer = new vscode.EventEmitter<string>();
  private readonly closer = new vscode.EventEmitter<void>();
  readonly onDidWrite = this.writer.event;
  readonly onDidClose = this.closer.event;

  private line: TerminalLineState = EMPTY_LINE;
  private activeRequestId: string | undefined;
  private lastSnapshot: AgentRunSnapshot | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly agent: AgentTerminalPort,
    private readonly state: AgentTerminalStatePort,
  ) {}

  open(): void {
    this.unsubscribe = this.state.subscribe((runs) => {
      this.runsChanged(runs);
    });
    this.writer.fire(
      toTerminalSafeText(
        vscode.l10n.t('ClawAI run terminal. Type a request and press Enter. Ctrl+C stops a run.'),
      ).text,
    );
    this.writer.fire(PROMPT);
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const requestId = this.activeRequestId;
    if (requestId !== undefined) {
      void this.agent.cancel(requestId);
    }
  }

  handleInput(data: string): void {
    const next = applyTerminalInput(this.line, data);
    this.writer.fire(next.echo);
    this.line = { buffer: next.buffer, echo: '' };
    if (next.signal === 'submit') {
      this.submit(next.buffer);
      return;
    }
    if (next.signal === 'cancel') {
      this.cancelActiveRun();
      return;
    }
    if (next.signal === 'close') {
      this.closer.fire();
    }
  }

  private submit(content: string): void {
    this.line = EMPTY_LINE;
    const request = content.trim();
    if (request.length === 0) {
      this.writer.fire(PROMPT);
      return;
    }
    if (this.activeRequestId !== undefined) {
      // Refusing is the honest answer. Queuing silently would leave the reader
      // watching a run that is not the one they just asked for.
      this.write(vscode.l10n.t('A run is already going. Press Ctrl+C to stop it first.'));
      this.writer.fire(PROMPT);
      return;
    }
    const requestId = randomUUID();
    this.activeRequestId = requestId;
    this.lastSnapshot = undefined;
    void this.agent
      .runAgent({ content: request, contextMode: 'workspace', requestId })
      .catch((error: unknown) => {
        this.finish(error instanceof Error ? error.message : vscode.l10n.t('ClawAI run failed.'));
      });
  }

  private cancelActiveRun(): void {
    const requestId = this.activeRequestId;
    if (requestId === undefined) {
      this.writer.fire(PROMPT);
      return;
    }
    void this.agent.cancel(requestId);
    this.finish(vscode.l10n.t('Run stopped.'));
  }

  private runsChanged(runs: Record<string, AgentRunSnapshot>): void {
    const requestId = this.activeRequestId;
    if (requestId === undefined) {
      return;
    }
    const snapshot = runs[requestId];
    if (snapshot === undefined) {
      return;
    }
    for (const line of describeRunChange(this.lastSnapshot, snapshot)) {
      this.write(renderLine(line));
    }
    this.lastSnapshot = snapshot;
    if (isRunFinished(snapshot)) {
      this.activeRequestId = undefined;
      this.lastSnapshot = undefined;
      this.writer.fire(PROMPT);
    }
  }

  private finish(message: string): void {
    this.activeRequestId = undefined;
    this.lastSnapshot = undefined;
    this.write(message);
    this.writer.fire(PROMPT);
  }

  private write(text: string): void {
    this.writer.fire(`\r\n${toTerminalSafeText(text).text}`);
  }
}

export function openAgentTerminal(
  agent: AgentTerminalPort,
  state: AgentTerminalStatePort,
): vscode.Terminal {
  const terminal = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    pty: new AgentTerminal(agent, state),
  });
  terminal.show(true);
  return terminal;
}
