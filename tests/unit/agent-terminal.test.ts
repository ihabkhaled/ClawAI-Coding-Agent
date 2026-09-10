import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  // Declared inside the factory because `vi.mock` is hoisted above every
  // top-level binding in the file.
  class Emitter<T> {
    private readonly listeners = new Set<(value: T) => void>();
    readonly event = (listener: (value: T) => void): { dispose: () => void } => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void {
      for (const listener of [...this.listeners]) {
        listener(value);
      }
    }
  }
  return {
    EventEmitter: Emitter,
    l10n: { t: (message: string) => message },
    window: { createTerminal: vi.fn(() => ({ show: vi.fn() })) },
  };
});

import { AgentTerminal } from '../../src/infrastructure/agent-terminal';

import type { AgentRunSnapshot } from '../../src/core/agent-run';

const ESC = '\u001B';

function harness() {
  const written: string[] = [];
  const runAgent = vi.fn<
    (input: { content: string; contextMode: 'workspace'; requestId: string }) => Promise<void>
  >(async () => undefined);
  const cancel = vi.fn<(requestId: string) => Promise<void>>(async () => undefined);
  let publish: ((runs: Record<string, AgentRunSnapshot>) => void) | undefined;
  const terminal = new AgentTerminal(
    { runAgent, cancel },
    {
      subscribe: (listener) => {
        publish = listener;
        return () => {
          publish = undefined;
        };
      },
      currentRuns: () => ({}),
    },
  );
  terminal.onDidWrite((chunk) => written.push(chunk));
  terminal.open();
  written.length = 0;
  return {
    cancel,
    runAgent,
    terminal,
    written,
    publish: (runs: Record<string, AgentRunSnapshot>) => publish?.(runs),
    text: () => written.join(''),
    requestId: () => runAgent.mock.calls[0]?.[0].requestId ?? '',
  };
}

describe('AgentTerminal', () => {
  it('starts a run from the typed line and echoes what was typed', () => {
    const seat = harness();
    seat.terminal.handleInput('rename the adapter');
    seat.terminal.handleInput('\r');

    expect(seat.text()).toContain('rename the adapter');
    expect(seat.runAgent).toHaveBeenCalledTimes(1);
    expect(seat.runAgent.mock.calls[0]?.[0]).toMatchObject({
      content: 'rename the adapter',
      contextMode: 'workspace',
    });
  });

  it('redraws the prompt on an empty line instead of starting a run', () => {
    const seat = harness();
    seat.terminal.handleInput('   \r');

    expect(seat.runAgent).not.toHaveBeenCalled();
    expect(seat.text()).toContain('clawai>');
  });

  it('prints each phase, file and command as the run reports it', () => {
    const seat = harness();
    seat.terminal.handleInput('do it\r');
    const requestId = seat.requestId();
    seat.publish({ [requestId]: { phase: 'reading', files: [], commands: [] } });
    seat.publish({
      [requestId]: {
        phase: 'applied',
        files: [{ operation: 'update', path: 'src/a.ts' }],
        commands: [{ command: 'npm test', purpose: 'verify' }],
        summary: 'Done.',
      },
    });

    const text = seat.text();
    expect(text).toContain('Reading workspace');
    expect(text).toContain('Applied file changes');
    expect(text).toContain('update src/a.ts');
    expect(text).toContain('$ npm test');
    expect(text).toContain('Done.');
  });

  it('never lets a summary move the cursor or rewrite the window title', () => {
    const seat = harness();
    seat.terminal.handleInput('do it\r');
    const requestId = seat.requestId();
    seat.publish({
      [requestId]: {
        phase: 'applied',
        files: [],
        commands: [],
        summary: `${ESC}[2J${ESC}]0;owned\u0007all clear`,
      },
    });

    expect(seat.text()).toContain('all clear');
    expect(seat.text()).not.toContain(ESC);
  });

  it('accepts a second request only after the first run has finished', () => {
    const seat = harness();
    seat.terminal.handleInput('first\r');
    seat.terminal.handleInput('second\r');

    expect(seat.runAgent).toHaveBeenCalledTimes(1);
    expect(seat.text()).toContain('A run is already going.');

    seat.publish({ [seat.requestId()]: { phase: 'verified', files: [], commands: [] } });
    seat.terminal.handleInput('third\r');

    expect(seat.runAgent).toHaveBeenCalledTimes(2);
  });

  it('stops the active run on Ctrl+C', () => {
    const seat = harness();
    seat.terminal.handleInput('long job\r');
    seat.terminal.handleInput('\u0003');

    expect(seat.cancel).toHaveBeenCalledWith(seat.requestId());
    expect(seat.text()).toContain('Run stopped.');
  });

  it('cancels the run it was watching when the terminal is closed', () => {
    const seat = harness();
    seat.terminal.handleInput('long job\r');
    seat.terminal.close();

    expect(seat.cancel).toHaveBeenCalledWith(seat.requestId());
  });

  it('ignores run snapshots that belong to another request', () => {
    const seat = harness();
    seat.terminal.handleInput('mine\r');
    seat.publish({ 'someone-else': { phase: 'applied', files: [], commands: [] } });

    expect(seat.text()).not.toContain('Applied file changes');
  });
});
