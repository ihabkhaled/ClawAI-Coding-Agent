import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { redactValue } from '../core/redaction';

import type { OutputLogger } from './output-logger';
import type { SubAgentOutcome, SubAgentTaskStatus } from '../core/multi-agent-dag';
import type { SubAgentCoordinatorObserver } from '../services/sub-agent-coordinator-service';
import type * as vscode from 'vscode';

export class VscodeSubAgentDiagnosticsSink implements SubAgentCoordinatorObserver {
  private readonly logFile: string;

  constructor(
    private readonly logger: Pick<OutputLogger, 'info' | 'warn'>,
    globalStorageUri: Pick<vscode.Uri, 'fsPath'>,
  ) {
    this.logFile = path.join(globalStorageUri.fsPath, 'sub-agent-diagnostics.log');
  }

  status(taskId: string, status: SubAgentTaskStatus, detail?: string): void {
    this.logger.info(
      `Sub-agent ${taskId} status: ${status}`,
      detail === undefined ? undefined : { detail },
    );
    this.append({ kind: 'status', taskId, status, detail, at: new Date().toISOString() });
  }

  outcome(outcome: SubAgentOutcome): void {
    this.logger.info(`Sub-agent ${outcome.taskId} outcome: ${outcome.status}`, outcome);
    this.append({ kind: 'outcome', outcome, at: new Date().toISOString() });
  }

  private append(entry: unknown): void {
    try {
      mkdirSync(path.dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `${JSON.stringify(redactValue(entry))}\n`, 'utf8');
    } catch (error: unknown) {
      this.logger.warn('Failed to write sub-agent diagnostics log', error);
    }
  }
}
