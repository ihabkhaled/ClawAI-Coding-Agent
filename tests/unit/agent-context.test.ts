import { describe, expect, it } from 'vitest';

import { readConcurrency, SPEED_MODES } from '../../src/core/speed-mode';
import { promptWithContext } from '../../src/sdk/agent-context';

import type { AgentContextFileSystem } from '../../src/sdk/agent-context.types';

const FILES = Array.from({ length: 24 }, (_unused, index) => `src/file-${String(index)}.ts`);

/** A file system that counts how many metadata lookups are in flight at once. */
function countingFileSystem(): { files: AgentContextFileSystem; peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  return {
    peak: () => peak,
    files: {
      list: () => Promise.resolve(FILES),
      stat: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return { isFile: true, size: 10 };
      },
      read: (_root, relativePath) =>
        Promise.resolve(new TextEncoder().encode(`body of ${relativePath}`)),
    },
  };
}

describe('--speed while the workspace is read', () => {
  it.each(SPEED_MODES)('runs %s at the lookup width the editor uses', async (speed) => {
    const counting = countingFileSystem();

    await promptWithContext(
      { workspaceRoot: '/ws', context: { mode: 'workspace' }, speed },
      'task',
      counting.files,
    );

    expect(counting.peak()).toBe(readConcurrency(speed));
  });

  it('changes how long it takes and never which files are chosen', async () => {
    const chosen: string[][] = [];
    for (const speed of SPEED_MODES) {
      const built = await promptWithContext(
        { workspaceRoot: '/ws', context: { mode: 'workspace' }, speed },
        'task',
        countingFileSystem().files,
      );
      chosen.push(built.receipt?.included.map((entry) => entry.path) ?? []);
    }

    expect(chosen[1]).toEqual(chosen[0]);
    expect(chosen[2]).toEqual(chosen[0]);
    expect(chosen[0]).toHaveLength(24);
  });

  it('stops at the editor file limit and reports what it left out', async () => {
    const many = Array.from({ length: 60 }, (_unused, index) => `f-${String(index)}.ts`);

    const built = await promptWithContext(
      { workspaceRoot: '/ws', context: { mode: 'workspace' } },
      'task',
      {
        list: () => Promise.resolve(many),
        stat: () => Promise.resolve({ isFile: true, size: 5 }),
        read: () => Promise.resolve(new TextEncoder().encode('12345')),
      },
    );

    expect(built.receipt?.included).toHaveLength(40);
    expect(built.receipt?.excluded.filter((entry) => entry.reason === 'limit')).toHaveLength(20);
    expect(built.receipt?.truncated).toBe(true);
  });

  it('does nothing for a mode that reads no workspace', async () => {
    const counting = countingFileSystem();

    const built = await promptWithContext(
      { workspaceRoot: '/ws', context: { mode: 'none' }, speed: '2X' },
      'task',
      counting.files,
    );

    expect(built.prompt).toBe('task');
    expect(counting.peak()).toBe(0);
  });
});

describe('the workspace listing', () => {
  it('leaves out sensitive and excluded files before reading them', async () => {
    const read: string[] = [];

    const built = await promptWithContext(
      { workspaceRoot: '/ws', context: { mode: 'workspace' } },
      'task',
      {
        list: () => Promise.resolve(['a.ts', '.env', 'config/credentials.json', 'dist/x.js']),
        stat: () => Promise.resolve({ isFile: true, size: 3 }),
        read: (_root, relativePath) => {
          read.push(relativePath);
          return Promise.resolve(new TextEncoder().encode('abc'));
        },
      },
    );

    expect(read).toEqual(['a.ts']);
    expect(built.receipt?.excluded.map((entry) => entry.path).sort()).toEqual([
      '.env',
      'config/credentials.json',
      'dist/x.js',
    ]);
  });

  it('refuses a file over the context limit instead of sending half of it', async () => {
    await expect(
      promptWithContext(
        { workspaceRoot: '/ws', context: { mode: 'file', file: 'big.bin' } },
        'task',
        {
          list: () => Promise.resolve([]),
          stat: () => Promise.resolve({ isFile: true, size: 5_000_000 }),
          read: () => Promise.resolve(new Uint8Array()),
        },
      ),
    ).rejects.toThrow('larger than');
  });
});
