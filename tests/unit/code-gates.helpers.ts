import { mkdirSync, mkdtempSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach } from 'vitest';

import { createGatesTool } from '../../src/sdk/code-gates-tool';

const created: string[] = [];
const REPO_MODULES = fileURLToPath(new URL('../../node_modules', import.meta.url));

/** Removes every fixture after each test; the node_modules junction goes first, never followed. */
export function cleanUpFixtures(): void {
  afterEach(() => {
    for (const directory of created.splice(0)) {
      try {
        rmdirSync(path.join(directory, 'node_modules'));
      } catch {
        // Not every fixture links node_modules.
      }
      try {
        rmSync(directory, { force: true, recursive: true, maxRetries: 25, retryDelay: 200 });
      } catch {
        // A just-killed process can still hold its folder on Windows; the OS temp dir absorbs it.
      }
    }
  });
}

export const GOOD_FILES: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({
    name: 'fx',
    version: '1.0.0',
    type: 'module',
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      build: 'tsc --noEmit false --outDir dist',
      'format:check': 'prettier --check .',
    },
  }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      target: 'ES2022',
      noEmit: true,
      rootDir: 'src',
    },
    include: ['src'],
  }),
  'eslint.config.mjs':
    "import tseslint from 'typescript-eslint';\n" +
    "export default [{ ignores: ['dist'] }, tseslint.configs.base, { files: ['**/*.ts'], rules: { 'no-var': 'error', eqeqeq: 'error' } }];\n",
  'vitest.config.mjs': "export default { test: { exclude: ['dist', 'node_modules'] } };\n",
  '.prettierrc.json': JSON.stringify({ singleQuote: true }),
  '.prettierignore':
    'dist\npackage.json\ntsconfig.json\neslint.config.mjs\nvitest.config.mjs\n.prettierrc.json\n',
  'src/math.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  'src/math.test.ts':
    "import { expect, test } from 'vitest';\nimport { add } from './math';\n\ntest('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n",
};

/** Writes files (relative path to text) under a folder, creating parents. */
export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

/** A TypeScript + vitest + eslint + prettier project, with the repo's tools linked in, plus overrides. */
export function fixtureProject(
  overrides: Readonly<Record<string, string>> = {},
  link = true,
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'claw-gates-'));
  created.push(root);
  writeFiles(root, { ...GOOD_FILES, ...overrides });
  if (link) symlinkSync(REPO_MODULES, path.join(root, 'node_modules'), 'junction');
  return root;
}

/** An empty folder tracked for cleanup. */
export function emptyFolder(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'claw-gates-'));
  created.push(root);
  return root;
}

export function gateLimits(root: string, extra: readonly string[] = []) {
  return { workspace: root, allowedExecutables: ['node', 'npm', 'npx', ...extra] };
}

type Result = Record<string, unknown>;

/** One call against a fresh or shared gates tool. */
export async function callGates(
  root: string,
  operation: string,
  args: Record<string, unknown>,
  options: {
    tool?: ReturnType<typeof createGatesTool>;
    extra?: readonly string[];
    signal?: AbortSignal;
  } = {},
): Promise<Result> {
  const tool = options.tool ?? createGatesTool();
  return (await Promise.resolve(
    tool.execute(operation, args, gateLimits(root, options.extra), options.signal),
  )) as Result;
}

export function summaryOf(result: Result): {
  errors: number;
  warnings: number;
  failedTests: { name: string; file: string; message: string }[];
  issues: string[];
} {
  return result.summary as ReturnType<typeof summaryOf>;
}
