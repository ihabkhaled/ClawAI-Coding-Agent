import { describe, expect, it } from 'vitest';

import { describeRunChange, isRunFinished } from '../../src/core/terminal-run-report';

import type { AgentRunSnapshot } from '../../src/core/agent-run';

function snapshot(patch: Partial<AgentRunSnapshot> = {}): AgentRunSnapshot {
  return { phase: 'reading', files: [], commands: [], ...patch };
}

describe('describeRunChange', () => {
  it('reports the first phase a run reaches', () => {
    expect(describeRunChange(undefined, snapshot())).toEqual([{ kind: 'phase', phase: 'reading' }]);
  });

  it('says nothing when the snapshot has not moved', () => {
    const current = snapshot({ phase: 'generating' });

    expect(describeRunChange(current, current)).toEqual([]);
  });

  it('reports only the files that are new since the last print', () => {
    const before = snapshot({ files: [{ operation: 'update', path: 'src/a.ts' }] });
    const after = snapshot({
      files: [
        { operation: 'update', path: 'src/a.ts' },
        { operation: 'create', path: 'src/b.ts' },
      ],
    });

    expect(describeRunChange(before, after)).toEqual([
      { kind: 'file', operation: 'create', path: 'src/b.ts' },
    ]);
  });

  it('treats the same path under a different operation as new', () => {
    const before = snapshot({ files: [{ operation: 'create', path: 'src/a.ts' }] });
    const after = snapshot({ files: [{ operation: 'delete', path: 'src/a.ts' }] });

    expect(describeRunChange(before, after)).toEqual([
      { kind: 'file', operation: 'delete', path: 'src/a.ts' },
    ]);
  });

  it('does not go backwards when a revised plan touches fewer files', () => {
    const before = snapshot({
      files: [
        { operation: 'update', path: 'src/a.ts' },
        { operation: 'update', path: 'src/b.ts' },
      ],
    });
    const after = snapshot({ files: [{ operation: 'update', path: 'src/a.ts' }] });

    expect(describeRunChange(before, after)).toEqual([]);
  });

  it('reports each command once', () => {
    const before = snapshot({ commands: [{ command: 'npm test', purpose: 'verify' }] });
    const after = snapshot({
      commands: [
        { command: 'npm test', purpose: 'verify' },
        { command: 'npm run build', purpose: 'package' },
      ],
    });

    expect(describeRunChange(before, after)).toEqual([
      { kind: 'command', command: 'npm run build', purpose: 'package' },
    ]);
  });

  it('holds a summary back until the run is actually over', () => {
    const running = snapshot({ phase: 'reviewing', summary: 'draft' });

    expect(describeRunChange(undefined, running)).toEqual([{ kind: 'phase', phase: 'reviewing' }]);
  });

  it('prints the summary once the run has finished', () => {
    const done = snapshot({ phase: 'applied', summary: 'Renamed the adapter.' });

    expect(describeRunChange(undefined, done)).toEqual([
      { kind: 'phase', phase: 'applied' },
      { kind: 'summary', text: 'Renamed the adapter.' },
    ]);
  });

  it('does not repeat a summary it has already printed', () => {
    const done = snapshot({ phase: 'applied', summary: 'Renamed the adapter.' });

    expect(describeRunChange(done, done)).toEqual([]);
  });
});

describe('isRunFinished', () => {
  it('is true only for the phases after which nothing more happens', () => {
    expect(isRunFinished(snapshot({ phase: 'verified' }))).toBe(true);
    expect(isRunFinished(snapshot({ phase: 'failed' }))).toBe(true);
    expect(isRunFinished(snapshot({ phase: 'rejected' }))).toBe(true);
    expect(isRunFinished(snapshot({ phase: 'executing' }))).toBe(false);
  });
});
