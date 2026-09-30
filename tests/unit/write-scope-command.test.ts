import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  call,
  cleanUpRepositories,
  git,
  nodeRun,
  put,
  scopedRepository,
  scopeOf,
} from './write-scope.helpers';

import type { WriteScopeViolation } from '../../src/sdk/write-scope.types';

afterEach(cleanUpRepositories);

const write = (name: string, text = 'made\\n'): string =>
  `require('node:fs').mkdirSync(require('node:path').dirname('${name}'),{recursive:true});require('node:fs').writeFileSync('${name}','${text}')`;

describe('workspace.command under a write scope', () => {
  it('leaves a command that only changes in-scope paths alone', async () => {
    const root = scopedRepository();

    const result = await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun(write('src/generated.ts')),
    );

    expect(result.exitCode).toBe(0);
    expect(result.writeScopeViolation).toBeUndefined();
    expect(existsSync(path.join(root, 'src/generated.ts'))).toBe(true);
  });

  it('reverts a new file the command wrote outside the scope and reports it', async () => {
    const root = scopedRepository();
    const seen: WriteScopeViolation[] = [];

    const result = await call(
      root,
      scopeOf(['src/**'], [], seen),
      'workspace.command',
      'run',
      nodeRun(write('errors/off-topic.ts')),
    );

    expect(result.writeScopeViolation).toEqual(['errors/off-topic.ts']);
    expect(result.reverted).toEqual(['errors/off-topic.ts']);
    expect(String(result.note)).toContain('outside the write scope');
    expect(existsSync(path.join(root, 'errors/off-topic.ts'))).toBe(false);
    expect(seen).toEqual([{ tool: 'workspace.command', paths: ['errors/off-topic.ts'] }]);
  });

  it('restores a tracked file the command edited outside the scope', async () => {
    const root = scopedRepository();

    const result = await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun("require('node:fs').appendFileSync('other.txt','more\\n')"),
    );

    expect(result.writeScopeViolation).toEqual(['other.txt']);
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('o\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('undoes a file the command deleted outside the scope', async () => {
    const root = scopedRepository();

    await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun("require('node:fs').unlinkSync('other.txt')"),
    );

    expect(existsSync(path.join(root, 'other.txt'))).toBe(true);
  });

  it('undoes a file the command staged outside the scope', async () => {
    const root = scopedRepository();

    const result = await call(root, scopeOf(['src/**']), 'workspace.command', 'run', {
      executable: 'node',
      arguments: [
        '-e',
        `${write('staged.txt')};require('node:child_process').execFileSync('git',['add','staged.txt'])`,
      ],
    });

    expect(result.writeScopeViolation).toEqual(['staged.txt']);
    expect(existsSync(path.join(root, 'staged.txt'))).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });

  it('does not count ignored files, in or out of scope', async () => {
    const root = scopedRepository();

    const result = await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun(`${write('ignored/cache.bin')};${write('run.log')}`),
    );

    expect(result.writeScopeViolation).toBeUndefined();
    expect(existsSync(path.join(root, 'ignored/cache.bin'))).toBe(true);
  });

  it('does not judge a path that was already dirty before the command', async () => {
    const root = scopedRepository();
    put(root, 'other.txt', 'operator edit\n');
    put(root, 'scratch.txt');

    const result = await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun("require('node:fs').appendFileSync('other.txt','x')"),
    );

    expect(result.writeScopeViolation).toBeUndefined();
    expect(existsSync(path.join(root, 'scratch.txt'))).toBe(true);
  });

  it('reverts at most 50 paths and says how many it left', async () => {
    const root = scopedRepository();
    const script = `for(let i=0;i<55;i++)require('node:fs').writeFileSync('junk'+i+'.txt','x')`;

    const result = await call(
      root,
      scopeOf(['src/**']),
      'workspace.command',
      'run',
      nodeRun(script),
    );

    expect((result.writeScopeViolation as string[]).length).toBe(50);
    expect((result.reverted as string[]).length).toBe(50);
    expect(String(result.note)).toContain('5 more were left');
  });

  it('checks a background command once it has finished', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);

    const started = await call(
      root,
      scope,
      'workspace.command',
      'run',
      nodeRun(write('late.txt'), { background: true }),
    );
    const report = await call(root, scope, 'workspace.command', 'wait', {
      processId: started.processId,
      timeoutMs: 20_000,
    });

    expect(report.writeScopeViolation).toEqual(['late.txt']);
    expect(existsSync(path.join(root, 'late.txt'))).toBe(false);
  });

  it('checks a background command when it is stopped', async () => {
    const root = scopedRepository();
    const scope = scopeOf(['src/**']);
    const script = `${write('stopped.txt')};setTimeout(()=>{},60000)`;

    const started = await call(
      root,
      scope,
      'workspace.command',
      'run',
      nodeRun(script, { background: true }),
    );
    await new Promise((done) => setTimeout(done, 1500));
    const report = await call(root, scope, 'workspace.command', 'stop', {
      processId: started.processId,
    });

    expect(report.writeScopeViolation).toEqual(['stopped.txt']);
  });

  it('refuses a program whose job is to change files, before it starts', async () => {
    const root = scopedRepository();

    await expect(
      call(root, scopeOf(['src/**']), 'workspace.command', 'run', {
        executable: 'rm',
        arguments: ['other.txt'],
      }),
    ).rejects.toThrow('workspace.command refused: "rm" changes files');
    await expect(
      call(root, scopeOf(['src/**']), 'workspace.command', 'run', {
        executable: 'git',
        arguments: ['add', 'other.txt'],
      }),
    ).rejects.toThrow('use workspace.git');
    expect(existsSync(path.join(root, 'other.txt'))).toBe(true);
  });

  it('allows the read-only git subcommands', async () => {
    const root = scopedRepository();

    const result = await call(root, scopeOf(['src/**']), 'workspace.command', 'run', {
      executable: 'git',
      arguments: ['status', '--short'],
    });

    expect(result.exitCode).toBe(0);
  });

  it('runs commands unchecked and unrefused when there is no scope', async () => {
    const root = scopedRepository();

    const result = await call(
      root,
      undefined,
      'workspace.command',
      'run',
      nodeRun(write('free.txt')),
    );

    expect(result.writeScopeViolation).toBeUndefined();
    expect(existsSync(path.join(root, 'free.txt'))).toBe(true);
  });
});
