import { describe, expect, it } from 'vitest';

import { OutputLogger } from '../../src/infrastructure/output-logger';

import type * as vscode from 'vscode';

function channel(lines: string[]): vscode.OutputChannel {
  return { appendLine: (line: string) => lines.push(line) } as never;
}

describe('OutputLogger.debug', () => {
  it('writes nothing unless the host log level asks for debug', () => {
    const lines: string[] = [];
    new OutputLogger(channel(lines)).debug('activate: 12 ms');
    expect(lines).toEqual([]);
  });

  it('writes a DEBUG line when the host log level allows it', () => {
    const lines: string[] = [];
    new OutputLogger(channel(lines), () => true).debug('activate: 12 ms');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ DEBUG activate: 12 ms$/u);
  });
});
