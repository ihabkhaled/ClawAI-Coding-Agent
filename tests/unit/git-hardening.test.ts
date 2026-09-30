import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hardenedGitArguments,
  hardenedGitEnvironment,
  isGitExecutable,
  programSpawningConfigKeys,
} from '../../src/core/git-hardening';
import { assertRepositoryConfigSafe, prepareGitSpawn } from '../../src/infrastructure/hardened-git';

describe('git hardening arguments', () => {
  it('pins every neutralising key before the subcommand', () => {
    const args = hardenedGitArguments(['status', '--porcelain'], 'NULLDEV');
    const pairs = args.filter((_, index) => args[index - 1] === '-c');
    expect(pairs).toEqual([
      'core.fsmonitor=false',
      'core.pager=cat',
      'core.editor=true',
      'diff.external=',
      'protocol.ext.allow=never',
      'core.sshCommand=',
      'core.hooksPath=NULLDEV',
    ]);
    expect(args.slice(-2)).toEqual(['status', '--porcelain']);
  });

  it('adds no-ext-diff and no-textconv after diff, show and log', () => {
    for (const sub of ['diff', 'show', 'log']) {
      const args = hardenedGitArguments([sub, '--stat'], 'x');
      expect(args.slice(-4)).toEqual([sub, '--no-ext-diff', '--no-textconv', '--stat']);
    }
  });

  it('recognises git executables only', () => {
    expect(isGitExecutable('git')).toBe(true);
    expect(isGitExecutable('C:\\Program Files\\Git\\cmd\\GIT.EXE')).toBe(true);
    expect(isGitExecutable('/usr/bin/git')).toBe(true);
    expect(isGitExecutable('gitk')).toBe(false);
    expect(isGitExecutable('node')).toBe(false);
  });

  it('strips program-naming variables and pins the safe ones', () => {
    const env = hardenedGitEnvironment({
      PATH: 'p',
      GIT_EXTERNAL_DIFF: 'evil',
      git_ssh_command: 'evil',
      GIT_PAGER: 'less',
    });
    expect(env).toEqual({
      PATH: 'p',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GIT_CONFIG_NOSYSTEM: '1',
    });
  });

  it('leaves non-git commands untouched', () => {
    const out = prepareGitSpawn('node', ['-v'], os.tmpdir(), { A: 'b', C: undefined });
    expect(out).toEqual({ arguments: ['-v'], environment: { A: 'b' } });
  });
});

describe('repository config scan', () => {
  it('finds program-spawning keys and ignores benign ones', () => {
    const text = [
      '[core]',
      '\tbare = false',
      '\taskpass = /tmp/evil',
      '[diff "x"]',
      '\ttextconv = evil',
      '[filter "lfs"]',
      '\tclean = git-lfs clean -- %f',
      '[filter "bad"]',
      '\tsmudge = sh -c evil',
      '[credential]',
      '\thelper = !evil',
      '[user]',
      '\tname = a',
    ].join('\n');
    expect(programSpawningConfigKeys(text)).toEqual([
      'core.askpass',
      'diff.x.textconv',
      'filter.bad.smudge',
      'credential.helper',
    ]);
  });

  it('refuses in an untrusted workspace and allows in a trusted one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ghard-'));
    try {
      spawnSync('git', ['init', '-q', dir]);
      writeFileSync(path.join(dir, '.git', 'config'), '[diff "x"]\n\ttextconv = evil\n', {
        flag: 'a',
      });
      expect(() => {
        assertRepositoryConfigSafe(dir, false);
      }).toThrow(/diff\.x\.textconv/u);
      expect(() => {
        assertRepositoryConfigSafe(dir, true);
      }).not.toThrow();
      expect(() => prepareGitSpawn('git', ['status'], dir, {})).toThrow(/untrusted/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not run a repo-chosen fsmonitor program under real git', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ghard-'));
    try {
      spawnSync('git', ['init', '-q', dir]);
      const marker = path.join(dir, 'ran.txt').replaceAll('\\', '/');
      const script = path.join(dir, 'fsm.sh').replaceAll('\\', '/');
      writeFileSync(script, `#!/bin/sh\necho x > "${marker}"\n`);
      spawnSync('git', ['config', 'core.fsmonitor', `sh ${script}`], { cwd: dir });
      const prepared = prepareGitSpawn('git', ['status', '--porcelain'], dir, process.env);
      const result = spawnSync('git', prepared.arguments, { cwd: dir, env: prepared.environment });
      expect(result.status).toBe(0);
      expect(() => statSync(path.join(dir, 'ran.txt'))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const SRC = path.resolve(__dirname, '../../src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Files that call a process spawner directly. Each either funnels git through
 * `prepareGitSpawn` or never runs git; a new spawner must be added here on
 * purpose, with the reason.
 */
const SPAWNERS_THAT_MAY_RUN_GIT = new Set([
  'infrastructure/bounded-command-runner.ts',
  'sdk/workspace-tool-executor.ts',
]);
const SPAWNERS_NEVER_GIT = new Set([
  'infrastructure/mcp/mcp-stdio-transport.ts',
  'infrastructure/native-elevation-adapter.ts',
  'infrastructure/process-terminator.ts',
  'headless/mcp/mcp-open-url.ts',
  'infrastructure/vscode-sandbox-probe.ts',
  'services/process-supervisor-service.ts',
]);

describe('every git spawn is hardened (guard)', () => {
  const spawnPattern = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\(/u;
  const importsSpawner = /from 'node:child_process'|from 'cross-spawn'|node-pty|import spawn from/u;

  it('only allow-listed files spawn processes, and git spawners use prepareGitSpawn', () => {
    const spawners = sourceFiles(SRC)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return importsSpawner.test(text) && spawnPattern.test(text);
      })
      .map((file) => path.relative(SRC, file).replaceAll('\\', '/'));
    const unknown = spawners.filter(
      (file) => !SPAWNERS_THAT_MAY_RUN_GIT.has(file) && !SPAWNERS_NEVER_GIT.has(file),
    );
    expect(unknown).toEqual([]);
    for (const file of SPAWNERS_THAT_MAY_RUN_GIT) {
      expect(readFileSync(path.join(SRC, file), 'utf8')).toContain('prepareGitSpawn(');
    }
    for (const file of SPAWNERS_NEVER_GIT) {
      expect(readFileSync(path.join(SRC, file), 'utf8')).not.toMatch(/['"]git['"]/u);
    }
  });

  it('git callers reach a spawner only through the hardened runners', () => {
    const gitCallers = sourceFiles(SRC).filter((file) =>
      /executable: 'git'|run\('git'|spawnBounded\('git'/u.test(readFileSync(file, 'utf8')),
    );
    expect(gitCallers.length).toBeGreaterThan(0);
    for (const file of gitCallers) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toMatch(/runCommandSpec|spawnBounded|this\.run\(/u);
      const relative = path.relative(SRC, file).replaceAll('\\', '/');
      if (!SPAWNERS_THAT_MAY_RUN_GIT.has(relative)) expect(text, file).not.toMatch(spawnPattern);
    }
  });
});
