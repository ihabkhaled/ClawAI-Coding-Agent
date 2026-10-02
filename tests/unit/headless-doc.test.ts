import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { HEADLESS_EXIT_CODES } from '../../src/core/headless-outcome.constants';
import {
  HEADLESS_BARE_FLAGS,
  HEADLESS_USAGE,
  HEADLESS_VALUE_FLAGS,
} from '../../src/headless/headless-args.constants';

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = readFileSync(path.join(ROOT, 'docs', 'HEADLESS.md'), 'utf8').replace(/\r\n/gu, '\n');
const SCHEMA = JSON.parse(
  readFileSync(path.join(ROOT, 'schemas', 'clawai-headless-events.schema.json'), 'utf8'),
) as {
  readonly definitions: Readonly<
    Record<string, { readonly properties?: { readonly type?: { readonly const?: string } } }>
  >;
};

/** The lines of one `## ` section, up to the next one. */
function section(heading: string): string[] {
  const lines = DOC.split('\n');
  const start = lines.findIndex((line) => line === `## ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

function firstCells(lines: readonly string[]): string[] {
  return lines
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split(/(?<!\\)\|/u)[1]?.trim() ?? '');
}

describe('docs/HEADLESS.md', () => {
  it('has one Flags row for every flag the parser knows, and none it does not', () => {
    const documented = firstCells(section('Flags')).flatMap((cell) =>
      [...cell.matchAll(/(?:^|[`\s,])(-{1,2}[A-Za-z][A-Za-z-]*)/gu)].map((match) => match[1] ?? ''),
    );
    const known = [...HEADLESS_BARE_FLAGS, ...Object.keys(HEADLESS_VALUE_FLAGS)].filter(
      (flag) => flag !== '--no-memory',
    );
    const twice = documented.filter((flag, index) => documented.indexOf(flag) !== index);

    expect(twice).toEqual([]);
    expect(known.filter((flag) => !documented.includes(flag))).toEqual([]);
    expect(documented.filter((flag) => !known.includes(flag) && flag !== '--no-memory')).toEqual(
      [],
    );
  });

  it('keeps every flag the usage text prints in the Flags table', () => {
    const flags = [...HEADLESS_USAGE.matchAll(/^ {2}(-{1,2}[A-Za-z][A-Za-z-]*)/gmu)].map(
      (m) => m[1],
    );
    const table = section('Flags').join('\n');

    expect(flags.filter((flag) => !table.includes(`\`${flag ?? ''}`))).toEqual([]);
  });

  it('lists the exit codes the runner really uses', () => {
    const rows = firstCells(section('Exit codes')).map((cell) => cell.replace(/`/gu, ''));
    const real = Object.values(HEADLESS_EXIT_CODES).map(String);

    expect([...rows].sort()).toEqual([...real].sort());
    const table = section('Exit codes');
    for (const [outcome, code] of Object.entries(HEADLESS_EXIT_CODES)) {
      const row = table.find((line) => line.startsWith(`| \`${String(code)}\``)) ?? '';

      expect(row, outcome).toContain(`\`${outcome}\``);
    }
  });

  it('describes every event the schema defines, once', () => {
    const rows = firstCells(section('Events')).map((cell) => cell.replace(/`/gu, ''));
    const schemaTypes = Object.values(SCHEMA.definitions)
      .map((entry) => entry.properties?.type?.const ?? '')
      .filter((type) => type !== '');
    const extra = ['images.not-delivered', 'context.collected'];

    expect(schemaTypes.filter((type) => !rows.includes(type))).toEqual([]);
    expect(extra.filter((type) => !rows.includes(type))).toEqual([]);
    expect(rows.filter((row, index) => rows.indexOf(row) !== index)).toEqual([]);
  });

  it('names every run.continued reason the runner can give', () => {
    const reasons = [
      'budget-exhausted',
      'run-lost',
      'stuck',
      'checks-failed',
      'plan-incomplete',
      'unknown-tool',
      'session-expired',
    ];
    const row = section('Events').find((line) => line.startsWith('| `run.continued`')) ?? '';

    expect(reasons.filter((reason) => !row.includes(reason))).toEqual([]);
  });

  it('closes every code fence and has no table row outside a table', () => {
    const fences = DOC.split('\n').filter((line) => /^`{3,}/u.test(line));
    const lines = DOC.split('\n');
    const strayRows = lines.filter(
      (line, index) =>
        line.startsWith('|') &&
        !lines[index - 1]?.startsWith('|') &&
        !lines[index + 1]?.startsWith('|'),
    );

    expect(fences.length % 2).toBe(0);
    expect(fences.every((fence) => /^`{3}(?!`)/u.test(fence))).toBe(true);
    expect(strayRows).toEqual([]);
  });

  it('links to the generated tool catalog', () => {
    expect(DOC).toContain('(TOOLS.md)');
  });
});
