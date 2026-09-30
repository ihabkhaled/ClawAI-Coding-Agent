import { describe, expect, it } from 'vitest';

import {
  CONTAINER_SCRIPT,
  PUSH_ARGS,
  dockerRunArgs,
  gateVerdict,
  releaseAssetPaths,
  releaseGateProblems,
  secretShapedAdditions,
} from '../../scripts/ship-lib.mjs';

const allAssets = releaseAssetPaths('1.90.0');

const EOL = String.fromCharCode(10);

describe('release gates before pushing', () => {
  it('lists the eight assets the Release workflow requires', () => {
    expect(allAssets).toHaveLength(8);
    expect(allAssets).toContain('builds/clawai-coding-agent-1.90.0.vsix.sha256');
    expect(allAssets).toContain('builds/clawai-coding-agent-1.90.0.provenance.json');
  });

  it('passes when the tag is free and every asset is tracked', () => {
    expect(
      releaseGateProblems({ version: '1.90.0', remoteTags: ['v1.89.0'], trackedFiles: allAssets }),
    ).toEqual([]);
  });

  it('refuses a version whose tag already exists (1.79.0 failed three times)', () => {
    const problems = releaseGateProblems({
      version: '1.90.0',
      remoteTags: ['v1.90.0'],
      trackedFiles: allAssets,
    });
    expect(problems.join('\n')).toMatch(/v1\.90\.0 already exists/u);
  });

  it('refuses assets that exist on disk but were never git added (builds/ is gitignored)', () => {
    const problems = releaseGateProblems({
      version: '1.90.0',
      remoteTags: [],
      trackedFiles: allAssets.slice(1),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not committed/u);
  });
});

describe('push protection', () => {
  // Assembled at run time: a literal token here would trip the very push
  // protection this test exists for.
  const gitlab = ['glpat', 'aB3dE5gH7jK9mN1pQ3rS'].join('-');
  const slackApp = ['xapp', '1', 'A0123456789', '1234567890', 'abcdef0123456789'].join('-');
  const sendgrid = ['SG', 'aB3dE5gH7jK9mN1pQ3rS', 'aB3dE5gH7jK9mN1pQ3rS'].join('.');
  const stripeHook = ['whsec', 'aB3dE5gH7jK9mN1pQ3rS4tU'].join('_');
  const githubPat = ['github', 'pat', 'A1b2C3d4E5'.repeat(3)].join('_');
  const added = (line: string): string => ['+++ b/tests/x.test.ts', `+${line}`].join(EOL);

  it('flags a plausible GitLab token in an added line', () => {
    expect(secretShapedAdditions(added(`const t = '${gitlab}';`))).toEqual([
      { file: 'tests/x.test.ts', label: 'GitLab token' },
    ]);
  });

  it('flags the other shapes that blocked or could block a push', () => {
    for (const literal of [slackApp, sendgrid, stripeHook, githubPat]) {
      expect(secretShapedAdditions(added(`x = '${literal}'`)).length).toBeGreaterThan(0);
    }
  });

  it('accepts tokens built from joined parts and obvious placeholders', () => {
    expect(
      secretShapedAdditions(added("t = ['glpat', 'aB3dE5gH7jK9mN1pQ3rS'].join('-');")),
    ).toEqual([]);
    expect(secretShapedAdditions(added("k = 'sk_live_example';"))).toEqual([]);
  });

  it('ignores removed and context lines', () => {
    const diff = ['+++ b/a.ts', `-const t = '${gitlab}';`, ' const u = 1;'].join(EOL);
    expect(secretShapedAdditions(diff)).toEqual([]);
  });
});

describe('GitHub gate verdict', () => {
  const run = (name: string, status: string, conclusion?: string) =>
    conclusion === undefined ? { name, status } : { name, status, conclusion };

  it('is pending until both workflows have completed', () => {
    expect(gateVerdict([run('CI', 'completed', 'success')]).state).toBe('pending');
    expect(gateVerdict([run('CI', 'in_progress'), run('Release', 'queued')]).state).toBe('pending');
  });

  it('is green only when both completed successfully', () => {
    expect(
      gateVerdict([run('CI', 'completed', 'success'), run('Release', 'completed', 'success')]),
    ).toEqual({ state: 'green', failed: [] });
  });

  it('is red as soon as one run fails, even while the other is still running', () => {
    expect(gateVerdict([run('CI', 'completed', 'failure'), run('Release', 'in_progress')])).toEqual(
      {
        state: 'red',
        failed: ['CI'],
      },
    );
  });
});

describe('the Linux gate', () => {
  it('runs as the unprivileged node user, like the GitHub runner', () => {
    const args = dockerRunArgs();
    expect(args[args.indexOf('--user') + 1]).toBe('node');
    expect(args).toContain('node:22-bookworm');
  });

  it('runs the steps CI runs, in the order CI runs them', () => {
    const order = [
      'npm ci --ignore-scripts',
      'l10n:build',
      'npm run check',
      'npm audit --omit=dev',
    ];
    const positions = order.map((needle) => CONTAINER_SCRIPT.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('makes a git repository first, because coverage:scope and l10n:verify read git', () => {
    expect(CONTAINER_SCRIPT.indexOf('git init')).toBeLessThan(CONTAINER_SCRIPT.indexOf('npm ci'));
  });

  it('pushes through the gh credential helper', () => {
    expect(PUSH_ARGS.join(' ')).toContain('credential.helper=!gh auth git-credential');
  });
});
