import * as vscode from 'vscode';

import { OutputLogger } from './output-logger';

export type { OutputLogger } from './output-logger';

let startedAt = performance.now();

/**
 * The ClawAI output channel. Debug lines follow the host's own log level
 * (Developer: Set Log Level), so there is no ClawAI setting for them and, at the
 * default level, they cost one comparison and print nothing.
 *
 * The activation clock starts here, the first thing `activate` builds once
 * configuration is read.
 */
export function createOutputLogger(name: string): OutputLogger {
  startedAt = performance.now();
  return new OutputLogger(
    vscode.window.createOutputChannel(name),
    () => vscode.env.logLevel <= vscode.LogLevel.Debug,
  );
}

/** Logs the synchronous cost of `activate`, then the cost including async initialization. */
export function logActivation(logger: OutputLogger, initialized: Promise<void>): Promise<void> {
  logger.debug(`activate: synchronous part ${(performance.now() - startedAt).toFixed(1)} ms`);
  return initialized.finally(() => {
    logger.debug(`activate: initialized after ${(performance.now() - startedAt).toFixed(1)} ms`);
  });
}
