import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { createAgent } from '../../src/sdk/create-agent';

import { cliWords } from './cli-words';
import { ALL_NOTES, realDefinitions, renderToolsDoc } from './tools-doc-render';

/** Words that look like arguments in an operation line but are values, not property names. */
const SPELLED_VALUES: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'powershell',
  'cmd',
  'lint',
  'typecheck',
  'test',
  'build',
  'format',
  'folder',
  'changed',
  'todo',
  'doing',
  'done',
  'blocked',
  'title',
  'check',
  'executable',
  'args',
  'steps',
  'timeoutMs',
  'id',
]);

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'TOOLS.md');

/** Every TypeScript file under src/, as one string, to find a failure message in. */
function sourceText(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceText(full);
      return entry.name.endsWith('.ts') ? readFileSync(full, 'utf8') : '';
    })
    .join('\n');
}

async function formatted(markdown: string): Promise<string> {
  const options = (await resolveConfig(DOC)) ?? {};
  return format(markdown, { ...options, parser: 'markdown' });
}

describe('docs/TOOLS.md', () => {
  it('is up to date with the tool definitions and the permission code (run `npm run docs:tools`)', async () => {
    const expected = await formatted(renderToolsDoc());
    if (process.env.UPDATE_TOOLS_DOC === '1') writeFileSync(DOC, expected, { encoding: 'utf8' });

    expect(readFileSync(DOC, 'utf8').replace(/\r\n/gu, '\n')).toBe(expected);
  });

  it('describes every tool the toolkit can offer, and no tool that is gone', () => {
    const real = realDefinitions().map((definition) => definition.name);

    expect([...ALL_NOTES.map((note) => note.tool)].sort()).toEqual([...real].sort());
  });

  it('lists exactly the real operations of each tool', () => {
    const byName = new Map(realDefinitions().map((definition) => [definition.name, definition]));
    for (const note of ALL_NOTES) {
      const real = [...(byName.get(note.tool)?.operations ?? [])].sort();

      expect(Object.keys(note.operations).sort(), note.tool).toEqual(real);
    }
  });

  it('writes every argument name it mentions in an operation line into the real input schema', () => {
    const byName = new Map(realDefinitions().map((definition) => [definition.name, definition]));
    const wrong: string[] = [];
    for (const note of ALL_NOTES) {
      const properties = Object.keys(byName.get(note.tool)?.inputSchema.properties ?? {});
      for (const [operation, text] of Object.entries(note.operations)) {
        const head = /^\{([^}]*)\}/u.exec(text)?.[1] ?? '';
        const names = head.match(/[A-Za-z]+(?=[?:,\]|\s]|$)/gu) ?? [];
        for (const name of names.filter((candidate) => /^[a-z][A-Za-z]*$/u.test(candidate))) {
          if (!properties.includes(name) && !SPELLED_VALUES.has(name)) {
            wrong.push(`${note.tool}.${operation}: ${name}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('quotes only failure messages that still exist in src/', () => {
    const source = sourceText(path.join(ROOT, 'src'));
    const missing = ALL_NOTES.flatMap((note) =>
      note.failures
        .filter((f) => !source.includes(f.message))
        .map((f) => `${note.tool}: ${f.message}`),
    );

    expect(missing).toEqual([]);
  });

  it('shows CLI examples the real argument parser accepts', () => {
    const rejected: string[] = [];
    for (const note of ALL_NOTES) {
      const argv = cliWords(note.cli).slice(1);
      const parsed = parseHeadlessArgs(argv, { CLAW_TOKEN: 'x' }, ROOT);
      if (parsed.kind !== 'run') {
        rejected.push(`${note.tool}: ${parsed.kind === 'usage' ? parsed.message : parsed.kind}`);
      }
    }

    expect(rejected).toEqual([]);
  });

  it('shows SDK examples that build a real agent', () => {
    const sandbox = {
      createAgent,
      token: 'x',
      dir: os.tmpdir(),
      approve: () => false,
      doneChecks: [],
    };
    for (const note of ALL_NOTES) {
      expect(note.sdk, note.tool).toContain('createAgent(');
      expect(() => runInNewContext(note.sdk, { ...sandbox }), note.tool).not.toThrow();
    }
  });
});
