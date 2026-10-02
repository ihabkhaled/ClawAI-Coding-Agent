import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { GateCommand, GateFileMode, GateName, GateProject } from './code-gates.types';

type Gates = Partial<Record<GateName, GateCommand>>;

/** Script names that stand for each gate, best first. */
const SCRIPT_NAMES: Readonly<Record<GateName, readonly string[]>> = {
  lint: ['lint', 'lint:check'],
  typecheck: ['typecheck', 'type-check', 'check-types', 'tsc'],
  test: ['test', 'test:unit'],
  build: ['build'],
  format: ['format:check', 'format-check', 'check:format', 'prettier:check', 'fmt:check'],
};

const ESLINT_CONFIG = /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.[a-z]+)?)$/u;
const PRETTIER_CONFIG = /^(?:\.prettierrc(?:\.[a-z0-9]+)?|prettier\.config\.[cm]?[jt]s)$/u;
const VITEST_CONFIG = /^vitest\.config\.[cm]?[jt]s$/u;
const JEST_CONFIG = /^jest\.config\.[cm]?[jt]s$/u;
const REWRITING_FLAG = /--(?:fix|write)\b/u;
const GATE_ORDER: readonly GateName[] = ['lint', 'typecheck', 'test', 'build', 'format'];

interface PackageFacts {
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: ReadonlySet<string>;
  readonly packageManagerField: string | undefined;
  readonly hasEslintField: boolean;
  readonly hasPrettierField: boolean;
}

interface NodeContext {
  readonly manager: string;
  readonly facts: PackageFacts;
  readonly files: ReadonlySet<string>;
  readonly has: (tool: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed package.json, or undefined when it is missing or not an object. */
export function readPackageJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function factsOf(pkg: Record<string, unknown>): PackageFacts {
  const names = [
    ...Object.keys(stringRecord(pkg.dependencies)),
    ...Object.keys(stringRecord(pkg.devDependencies)),
  ];
  return {
    scripts: stringRecord(pkg.scripts),
    dependencies: new Set(names),
    packageManagerField: typeof pkg.packageManager === 'string' ? pkg.packageManager : undefined,
    hasEslintField: pkg.eslintConfig !== undefined,
    hasPrettierField: pkg.prettier !== undefined,
  };
}

const LOCKFILES: readonly (readonly [string, string])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The package manager: the `packageManager` field, else the nearest lockfile, else npm. */
export function packageManagerOf(
  workspace: string,
  dir: string,
  field: string | undefined,
): string {
  const named = field?.split('@')[0];
  if (named === 'pnpm' || named === 'yarn' || named === 'bun' || named === 'npm') return named;
  let current = dir;
  for (;;) {
    const found = LOCKFILES.find(([file]) => existsSync(path.join(current, file)));
    if (found !== undefined) return found[1];
    const parent = path.dirname(current);
    if (current === workspace || parent === current) return 'npm';
    current = parent;
  }
}

/** Whether a tool's launcher is installed in this folder or any parent up to the workspace. */
function hasBin(workspace: string, dir: string, tool: string): boolean {
  let current = dir;
  for (;;) {
    const bin = path.join(current, 'node_modules', '.bin', tool);
    if (existsSync(bin) || existsSync(`${bin}.cmd`)) return true;
    const parent = path.dirname(current);
    if (current === workspace || parent === current) return false;
    current = parent;
  }
}

function command(
  executable: string,
  args: readonly string[],
  fileMode?: GateFileMode,
): GateCommand {
  return { executable, args, display: [executable, ...args].join(' '), fileMode };
}

function runScript(manager: string, script: string): GateCommand {
  return command(manager, manager === 'yarn' ? [script] : ['run', script]);
}

function execTool(manager: string, tool: string, args: readonly string[]): readonly string[] {
  if (manager === 'pnpm') return ['pnpm', 'exec', tool, ...args];
  if (manager === 'yarn') return ['yarn', tool, ...args];
  if (manager === 'bun') return ['bunx', tool, ...args];
  return ['npx', '--no-install', tool, ...args];
}

function toolCommand(
  manager: string,
  tool: string,
  args: readonly string[],
  fileMode?: GateFileMode,
): GateCommand {
  const [executable = 'npx', ...rest] = execTool(manager, tool, args);
  return command(executable, rest, fileMode);
}

/** The script that stands for a gate, skipping the npm stub and scripts that rewrite files. */
function scriptFor(gate: GateName, scripts: Readonly<Record<string, string>>): string | undefined {
  return SCRIPT_NAMES[gate].find((name) => {
    const body = scripts[name];
    if (body === undefined || body.includes('no test specified')) return false;
    return !REWRITING_FLAG.test(body);
  });
}

function anyFile(files: ReadonlySet<string>, pattern: RegExp): boolean {
  return [...files].some((name) => pattern.test(name));
}

/** Direct tool commands, each taking a file list after its arguments. */
function fileGatesOf(context: NodeContext): Gates {
  const { manager, facts, files, has } = context;
  const gates: Gates = {};
  if (has('eslint') && (anyFile(files, ESLINT_CONFIG) || facts.hasEslintField)) {
    gates.lint = toolCommand(manager, 'eslint', [], 'eslint');
  }
  if (has('prettier') && (anyFile(files, PRETTIER_CONFIG) || facts.hasPrettierField)) {
    gates.format = toolCommand(manager, 'prettier', ['--check'], 'prettier');
  }
  const runner = testRunnerGate(context);
  if (runner !== undefined) gates.test = runner;
  return gates;
}

/** vitest, else jest, when installed and either a dependency or configured. */
function testRunnerGate(context: NodeContext): GateCommand | undefined {
  const { manager, facts, files, has } = context;
  if (has('vitest') && (facts.dependencies.has('vitest') || anyFile(files, VITEST_CONFIG))) {
    return toolCommand(manager, 'vitest', ['run'], 'vitest');
  }
  if (has('jest') && (facts.dependencies.has('jest') || anyFile(files, JEST_CONFIG))) {
    return toolCommand(manager, 'jest', ['--runTestsByPath'], 'jest');
  }
  return undefined;
}

function wholeProject(
  gate: GateCommand | undefined,
  rest: readonly string[],
): GateCommand | undefined {
  return gate === undefined ? undefined : command(gate.executable, [...gate.args, ...rest]);
}

function fallback(gates: Gates, name: GateName, value: GateCommand | undefined): void {
  if (gates[name] === undefined && value !== undefined) gates[name] = value;
}

/** The gates of a package: its own scripts first, then the tools it has installed. */
function gatesOf(context: NodeContext, direct: Gates): Gates {
  const { manager, facts, files, has } = context;
  const gates: Gates = {};
  for (const name of GATE_ORDER) {
    const script = scriptFor(name, facts.scripts);
    if (script !== undefined) gates[name] = runScript(manager, script);
  }
  fallback(gates, 'lint', wholeProject(direct.lint, ['.']));
  fallback(gates, 'format', wholeProject(direct.format, ['.']));
  fallback(gates, 'test', wholeProject(direct.test, []));
  if (gates.typecheck === undefined && files.has('tsconfig.json')) {
    const tool = has('tsgo') ? 'tsgo' : has('tsc') ? 'tsc' : undefined;
    if (tool !== undefined) gates.typecheck = toolCommand(manager, tool, ['--noEmit']);
  }
  return gates;
}

/** The Node project in `dir`, or undefined when it has no package.json. */
export function nodeProject(
  workspace: string,
  dir: string,
  relative: string,
): GateProject | undefined {
  const pkg = readPackageJson(path.join(dir, 'package.json'));
  if (pkg === undefined) return undefined;
  const facts = factsOf(pkg);
  const files = new Set(readdirSync(dir));
  const manager = packageManagerOf(workspace, dir, facts.packageManagerField);
  const context: NodeContext = {
    manager,
    facts,
    files,
    has: (tool) => hasBin(workspace, dir, tool),
  };
  const fileGates = fileGatesOf(context);
  const tools = ['eslint', 'prettier', 'vitest', 'jest', 'tsc', 'tsgo'].filter(context.has);
  return {
    dir: relative,
    ecosystem: 'node',
    packageManager: manager,
    tools,
    gates: gatesOf(context, fileGates),
    fileGates,
  };
}
