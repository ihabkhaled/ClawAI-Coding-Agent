import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { GateCommand, GateName, GateProject } from './code-gates.types';

type Gates = Partial<Record<GateName, GateCommand>>;

function command(executable: string, args: readonly string[], failOnOutput?: boolean): GateCommand {
  return { executable, args, display: [executable, ...args].join(' '), failOnOutput };
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** A Cargo project: the standard cargo commands, no configuration needed. */
export function rustProject(dir: string, relative: string): GateProject | undefined {
  if (!existsSync(path.join(dir, 'Cargo.toml'))) return undefined;
  const gates: Gates = {
    lint: command('cargo', ['clippy', '--all-targets']),
    typecheck: command('cargo', ['check']),
    test: command('cargo', ['test']),
    build: command('cargo', ['build']),
    format: command('cargo', ['fmt', '--check']),
  };
  return {
    dir: relative,
    ecosystem: 'rust',
    packageManager: 'cargo',
    tools: ['cargo'],
    gates,
    fileGates: {},
  };
}

/** A Go module: vet, build, test and gofmt, which lists files instead of failing. */
export function goProject(dir: string, relative: string): GateProject | undefined {
  if (!existsSync(path.join(dir, 'go.mod'))) return undefined;
  const gates: Gates = {
    lint: command('go', ['vet', './...']),
    typecheck: command('go', ['build', './...']),
    test: command('go', ['test', './...']),
    build: command('go', ['build', './...']),
    format: command('gofmt', ['-l', '.'], true),
  };
  return {
    dir: relative,
    ecosystem: 'go',
    packageManager: 'go',
    tools: ['go'],
    gates,
    fileGates: {},
  };
}

/** A Python project, judged from pyproject.toml and the usual ini files. */
export function pythonProject(dir: string, relative: string): GateProject | undefined {
  const known = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'mypy.ini', 'ruff.toml'];
  if (!known.some((name) => existsSync(path.join(dir, name)))) return undefined;
  const pyproject = readText(path.join(dir, 'pyproject.toml'));
  const has = (needle: string, ini: string): boolean =>
    pyproject.includes(needle) || existsSync(path.join(dir, ini));
  const gates: Gates = {};
  const tools: string[] = [];
  if (has('[tool.ruff', 'ruff.toml')) {
    gates.lint = command('ruff', ['check', '.']);
    gates.format = command('ruff', ['format', '--check', '.']);
    tools.push('ruff');
  }
  if (has('[tool.mypy', 'mypy.ini')) {
    gates.typecheck = command('mypy', ['.']);
    tools.push('mypy');
  }
  if (has('[tool.pytest', 'pytest.ini') || existsSync(path.join(dir, 'tests'))) {
    gates.test = command('pytest', ['-q']);
    tools.push('pytest');
  }
  return { dir: relative, ecosystem: 'python', packageManager: 'pip', tools, gates, fileGates: {} };
}
