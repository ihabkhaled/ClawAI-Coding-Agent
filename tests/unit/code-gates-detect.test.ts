import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  callGates,
  cleanUpFixtures,
  emptyFolder,
  fixtureProject,
  writeFiles,
} from './code-gates.helpers';

cleanUpFixtures();

interface Projects {
  projects: {
    dir: string;
    gates: Record<string, string>;
    tools: string[];
    packageManager?: string;
  }[];
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: root,
    stdio: 'ignore',
  });
}

describe('code.gates detect', () => {
  it('finds the scripts and tools of a Node project', async () => {
    const root = fixtureProject();
    const found = (await callGates(root, 'detect', {})) as unknown as Projects;
    const [project] = found.projects;
    expect(project?.dir).toBe('.');
    expect(project?.packageManager).toBe('npm');
    expect(project?.gates).toEqual({
      lint: 'npm run lint',
      typecheck: 'npm run typecheck',
      test: 'npm run test',
      build: 'npm run build',
      format: 'npm run format:check',
    });
    expect(project?.tools).toEqual(expect.arrayContaining(['eslint', 'prettier', 'vitest', 'tsc']));
  });

  it('falls back to the installed tools when there are no scripts', async () => {
    const root = fixtureProject({
      'package.json': JSON.stringify({
        name: 'bare',
        type: 'module',
        devDependencies: { vitest: '*' },
      }),
    });
    const found = (await callGates(root, 'detect', {})) as unknown as Projects;
    expect(found.projects[0]?.gates).toEqual({
      lint: 'npx --no-install eslint .',
      typecheck: 'npx --no-install tsc --noEmit',
      test: 'npx --no-install vitest run',
      format: 'npx --no-install prettier --check .',
    });
  });

  it('never picks a script that rewrites files or the npm test stub', async () => {
    const root = fixtureProject({
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { lint: 'eslint . --fix', test: 'echo "Error: no test specified" && exit 1' },
      }),
    });
    const gates = ((await callGates(root, 'detect', {})) as unknown as Projects).projects[0]?.gates;
    expect(gates?.lint).toBe('npx --no-install eslint .');
    expect(gates?.test).toBe('npx --no-install vitest run');
  });

  it('uses the package manager the lockfile or field names', async () => {
    const root = fixtureProject({
      'package.json': JSON.stringify({ name: 'p', scripts: { lint: 'eslint .' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    });
    const project = ((await callGates(root, 'detect', {})) as unknown as Projects).projects[0];
    expect(project?.packageManager).toBe('pnpm');
    expect(project?.gates.lint).toBe('pnpm run lint');
  });

  it('knows cargo, go and python projects from their manifests', async () => {
    const root = emptyFolder();
    writeFiles(root, {
      'rs/Cargo.toml': '[package]\nname = "x"\n',
      'go/go.mod': 'module x\n',
      'py/pyproject.toml': '[tool.ruff]\n[tool.mypy]\n[tool.pytest.ini_options]\n',
    });
    const rust = (await callGates(root, 'detect', { scope: 'rs' })) as unknown as Projects;
    expect(rust.projects[0]?.gates.test).toBe('cargo test');
    expect(rust.projects[0]?.gates.format).toBe('cargo fmt --check');
    const go = (await callGates(root, 'detect', { scope: 'go' })) as unknown as Projects;
    expect(go.projects[0]?.gates.format).toBe('gofmt -l .');
    const python = (await callGates(root, 'detect', { scope: 'py' })) as unknown as Projects;
    expect(python.projects[0]?.gates).toEqual({
      lint: 'ruff check .',
      format: 'ruff format --check .',
      typecheck: 'mypy .',
      test: 'pytest -q',
    });
  });

  it('lists monorepo workspace folders and the folders holding changes', async () => {
    const root = emptyFolder();
    writeFiles(root, {
      'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a', scripts: { test: 'node a.js' } }),
      'packages/a/a.js': 'console.log(1);\n',
      'packages/b/package.json': JSON.stringify({ name: 'b', scripts: { test: 'node b.js' } }),
      'packages/b/b.js': 'console.log(2);\n',
    });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    writeFileSync(path.join(root, 'packages/a/a.js'), 'console.log(3);\n');
    writeFileSync(path.join(root, 'packages/a/new.js'), 'x\n');
    const found = (await callGates(root, 'detect', {})) as unknown as {
      workspaces: { kind: string; dirs: string[] };
      changed: { files: number; folders: { dir: string; files: number; gates: string[] }[] };
    };
    expect(found.workspaces).toMatchObject({
      kind: 'npm workspaces',
      dirs: ['packages/a', 'packages/b'],
    });
    expect(found.changed.files).toBe(2);
    expect(found.changed.folders).toEqual([{ dir: 'packages/a', files: 2, gates: ['test'] }]);
  });

  it('refuses to run a gate over a whole monorepo by default', async () => {
    const root = emptyFolder();
    writeFiles(root, {
      'package.json': JSON.stringify({
        name: 'm',
        workspaces: ['packages/*'],
        scripts: { test: 'node -e 0' },
      }),
      'packages/a/package.json': JSON.stringify({ name: 'a', scripts: { test: 'node -e 0' } }),
      'packages/b/package.json': JSON.stringify({ name: 'b', scripts: { test: 'node -e 0' } }),
    });
    await expect(callGates(root, 'run', { gate: 'test' })).rejects.toThrow(
      /monorepo.*packages\/a, packages\/b/su,
    );
    expect(await callGates(root, 'run', { gate: 'test', scope: 'packages/a' })).toMatchObject({
      status: 'pass',
      dir: 'packages/a',
    });
  }, 60_000);

  it('says so when the workspace is not a git repository', async () => {
    const root = fixtureProject();
    const found = (await callGates(root, 'detect', {})) as { changed: { problem: string } };
    expect(found.changed.problem).toContain('not a git repository');
  });

  it('refuses a scope outside the workspace', async () => {
    const root = fixtureProject();
    await expect(callGates(root, 'detect', { scope: '..' })).rejects.toThrow(/escapes/u);
  });
});

describe('code.gates run with scope changed', () => {
  it('runs the gate only in the folder with changes', async () => {
    const root = emptyFolder();
    const marker = (name: string): string =>
      `node -e "require('fs').writeFileSync('ran-${name}','x')"`;
    writeFiles(root, {
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a', scripts: { test: marker('a') } }),
      'packages/b/package.json': JSON.stringify({ name: 'b', scripts: { test: marker('b') } }),
    });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    writeFileSync(path.join(root, 'packages/b/touched.txt'), 'x\n');
    const result = await callGates(root, 'run', { gate: 'test', scope: 'changed' });
    expect(result).toMatchObject({ status: 'pass', dir: 'packages/b' });
    const { existsSync } = await import('node:fs');
    expect(existsSync(path.join(root, 'packages/b/ran-b'))).toBe(true);
    expect(existsSync(path.join(root, 'packages/a/ran-a'))).toBe(false);
  });

  it('refuses scope changed when nothing changed', async () => {
    const root = emptyFolder();
    writeFiles(root, { 'package.json': JSON.stringify({ name: 'x' }) });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    await expect(callGates(root, 'run', { gate: 'test', scope: 'changed' })).rejects.toThrow(
      /no files have changed/u,
    );
  });
});
