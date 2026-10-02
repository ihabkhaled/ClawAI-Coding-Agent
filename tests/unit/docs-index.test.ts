import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { parsePlanFile } from '../../src/headless/headless-plan-file';

import { cliWords } from './cli-words';

const ROOT = path.resolve(__dirname, '..', '..');
const NEW_SKILLS: readonly string[] = [
  'deliver-a-flagship-with-the-agent',
  'test-a-ui-with-the-browser-tool',
  'test-an-api-with-http-request',
  'run-long-commands-with-process-watch',
  'orchestrate-parallel-agents',
  'write-a-plan-file',
];
const NEW_DOCS: readonly string[] = ['docs/TOOLS.md', 'docs/FAQ-AGENT-TOOLS.md'];

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/gu, '\n');
}

function skillFolders(): string[] {
  return readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The text of every fenced block with this info string, backslash continuations joined. */
function blocks(markdown: string, info: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`^\`\`\`${info}\\n([\\s\\S]*?)^\`\`\``, 'gmu');
  for (const match of markdown.matchAll(pattern)) found.push(match[1] ?? '');
  return found;
}

function commandLines(markdown: string): string[] {
  return blocks(markdown, 'sh')
    .flatMap((block) => block.replace(/\\\n\s*/gu, ' ').split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('clawai '));
}

/** The arguments of a documented command: cut at a comment, a pipe or `;`, and `$VARIABLES` stand in as 'x'. */
function argvOf(line: string): string[] {
  const argv: string[] = [];
  for (const word of cliWords(line).slice(1)) {
    if (word === '#' || word === '|') break;
    const ended = word.endsWith(';');
    argv.push(word.startsWith('$') ? 'x' : ended ? word.slice(0, -1) : word);
    if (ended) break;
  }
  return argv;
}

const DOCS_WITH_COMMANDS: readonly string[] = [
  ...NEW_SKILLS.map((name) => `skills/${name}/SKILL.md`),
  'docs/FAQ-AGENT-TOOLS.md',
  'docs/HEADLESS.md',
];

describe('the skills and docs for the agent tools', () => {
  it('gives every skill folder a SKILL.md whose name is the folder and that has a description', () => {
    const bad = skillFolders().filter((folder) => {
      const file = path.join('skills', folder, 'SKILL.md');
      if (!existsSync(path.join(ROOT, file))) return true;
      const text = read(file);
      return !text.startsWith(`---\nname: ${folder}\ndescription: `);
    });

    expect(bad).toEqual([]);
  });

  it('lists every skill in CLAUDE.md and in AGENTS.md', () => {
    const claude = read('CLAUDE.md');
    const agents = read('AGENTS.md');
    const missing = skillFolders().flatMap((folder) => [
      ...(claude.includes(folder) ? [] : [`CLAUDE.md: ${folder}`]),
      ...(agents.includes(folder) ? [] : [`AGENTS.md: ${folder}`]),
    ]);

    expect(missing).toEqual([]);
  });

  it('reaches the new docs from the routers and the README', () => {
    const routers = `${read('CLAUDE.md')}\n${read('AGENTS.md')}`;

    for (const doc of NEW_DOCS) expect(routers, doc).toContain(doc);
    expect(read('README.md')).toContain('docs/TOOLS.md');
    expect(read('README.md')).toContain('docs/FAQ-AGENT-TOOLS.md');
  });

  it('shows only clawai commands the real argument parser accepts', () => {
    const rejected: string[] = [];
    for (const file of DOCS_WITH_COMMANDS) {
      for (const line of commandLines(read(file))) {
        const parsed = parseHeadlessArgs(argvOf(line), { CLAW_TOKEN: 'x' }, ROOT);
        if (parsed.kind === 'usage')
          rejected.push(`${file}: ${line.slice(0, 60)}: ${parsed.message}`);
      }
    }

    expect(rejected).toEqual([]);
  });

  it('has at least one worked command in each skill', () => {
    for (const name of NEW_SKILLS) {
      expect(commandLines(read(`skills/${name}/SKILL.md`)).length, name).toBeGreaterThan(0);
    }
  });

  it('shows plan files the real loader accepts', () => {
    const plans = blocks(read('skills/write-a-plan-file/SKILL.md'), 'json');

    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(typeof parsePlanFile(plan)).toBe('object');
  });

  it('keeps the README section on the safe defaults', () => {
    const readme = read('README.md');
    const start = readme.indexOf('### Let the agent test and ship for you');
    const section = readme.slice(start, readme.indexOf('### Privacy and zero-retention'));

    expect(start).toBeGreaterThan(-1);
    for (const phrase of [
      'off until you turn it on',
      'The shell is off',
      'only reach websites you name',
    ]) {
      expect(section, phrase).toContain(phrase);
    }
  });
});
