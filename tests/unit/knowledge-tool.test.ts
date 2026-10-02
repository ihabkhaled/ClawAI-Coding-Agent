import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createKnowledgeTool } from '../../src/sdk/knowledge-tool';
import {
  KNOWLEDGE_INDEX_MAX_CHARS,
  KNOWLEDGE_READ_MAX_CHARS,
  KNOWLEDGE_SEARCH_MAX_CHARS,
  KNOWLEDGE_TASK_MAX_CHARS,
  KNOWLEDGE_UNTRUSTED_NOTICE,
  KNOWLEDGE_WALK_MAX_FILES,
} from '../../src/sdk/knowledge-tool.constants';

import { acmeRepository, cleanFixtures, fixture } from './knowledge-fixture';

afterEach(cleanFixtures);

function call(
  root: string,
  operation: string,
  args: Readonly<Record<string, unknown>> = {},
): string {
  return createKnowledgeTool(root).execute(operation, args);
}

function huge(lines: number): string {
  const sections = Array.from(
    { length: lines / 10 },
    (_unused, index) =>
      `## Section ${String(index)}\n${Array.from({ length: 9 }, (_x, line) => `line ${String(index)}.${String(line)} filler text for the section`).join('\n')}`,
  );
  return `# Huge\n\n${sections.join('\n')}\n`;
}

describe('knowledge.context index', () => {
  it('lists the root instruction files and the areas, with sizes', () => {
    const out = call(acmeRepository(), 'index');

    expect(out).toContain(KNOWLEDGE_UNTRUSTED_NOTICE);
    expect(out).toMatch(/Root instruction files: CLAUDE\.md [\d.]+ (?:B|KB), AGENTS\.md/u);
    expect(out).toContain('rules: 4 files');
    expect(out).toContain('skills/runbooks: 2 files');
    expect(out).toContain('apps/acme-chat-service/CLAUDE.md');
  });

  it('never lists node_modules, dist, .git, gitignored paths, code or secrets', () => {
    const out = call(acmeRepository(), 'index', { prefix: '' });
    const everywhere = [
      call(acmeRepository(), 'index'),
      out,
      call(acmeRepository(), 'index', { prefix: 'docs' }),
    ].join('\n');

    for (const hidden of ['node_modules', 'dist/', 'ignored/', 'private.md', 'index.ts', '.env']) {
      expect(everywhere).not.toContain(hidden);
    }
  });

  it('lists one directory with sizes when given a prefix, and says so when it is empty', () => {
    const root = acmeRepository();

    const rules = call(root, 'index', { prefix: 'rules' });
    expect(rules).toContain('4 knowledge files under rules');
    expect(rules).toContain('rules/52-every-schema-ships-a-migration.md');
    expect(call(root, 'index', { prefix: 'nope' })).toContain('No knowledge files under "nope"');
  });

  it('stops at its file limit and says the list is a prefix', () => {
    const files: Record<string, string> = { 'CLAUDE.md': '# Root\n' };
    for (let index = 0; index < KNOWLEDGE_WALK_MAX_FILES + 20; index += 1) {
      files[`docs/d${String(index)}.md`] = '# d\n';
    }
    const out = call(fixture(files), 'index');

    expect(out).toContain('walk stopped at its limit');
    expect(out.length).toBeLessThanOrEqual(KNOWLEDGE_INDEX_MAX_CHARS + 200);
  });

  it('honours a nested .gitignore', () => {
    const root = fixture({
      'CLAUDE.md': '# Root\n',
      'pkg/.gitignore': 'generated/\n',
      'pkg/generated/out.md': '# generated\n',
      'pkg/real.md': '# real\n',
    });

    const out = call(root, 'index', { prefix: 'pkg' });

    expect(out).toContain('pkg/real.md');
    expect(out).not.toContain('generated');
  });
});

describe('knowledge.context read', () => {
  it('returns a small file whole', () => {
    const out = call(acmeRepository(), 'read', { path: 'rules/07-commit-rules.md' });

    expect(out).toContain('rules/07-commit-rules.md');
    expect(out).toContain('One commit, one push.');
  });

  it('returns exactly the lines asked for, labelled', () => {
    const out = call(acmeRepository(), 'read', {
      path: 'rules/07-commit-rules.md',
      startLine: 5,
      endLine: 6,
    });

    expect(out).toContain('lines 5-6 of');
    expect(out).toContain('One commit, one push.');
    expect(out).not.toContain('Never skip a hook.');
  });

  it('gives a huge file as an outline with line ranges instead of its text', () => {
    const root = fixture({ 'CLAUDE.md': huge(1_700) });

    const out = call(root, 'read', { path: 'CLAUDE.md' });

    expect(out.length).toBeLessThan(KNOWLEDGE_READ_MAX_CHARS);
    expect(out).toContain('too large to return whole');
    expect(out).toMatch(/\d+-\d+ Section 0/u);
    expect(out).not.toContain('filler text');
  });

  it('cuts a requested range at the limit and names where to continue', () => {
    const root = fixture({ 'CLAUDE.md': huge(1_700) });

    const out = call(root, 'read', { path: 'CLAUDE.md', startLine: 1, endLine: 1_500 });

    expect(out.length).toBeLessThan(KNOWLEDGE_READ_MAX_CHARS + 400);
    expect(out).toMatch(/continue at startLine \d+/u);
  });

  it('refuses code, secrets, manifests outside knowledge directories and non-files', () => {
    const root = acmeRepository();

    for (const refused of ['src/index.ts', '.env', 'package.json']) {
      expect(() => call(root, 'read', { path: refused })).toThrow(/not a knowledge file/u);
    }
    expect(() => call(root, 'read', { path: 'rules' })).toThrow(
      /not a knowledge file|does not exist/u,
    );
  });

  it('refuses a path that leaves the workspace, relative or absolute', () => {
    const root = acmeRepository();
    const outside = fixture({ 'secret.md': '# not yours\n' });

    expect(() => call(root, 'read', { path: '../x.md' })).toThrow(/inside the workspace/u);
    expect(() => call(root, 'read', { path: path.join(outside, 'secret.md') })).toThrow(
      /inside the workspace/u,
    );
  });

  it('refuses a symbolic link, even one that points at a knowledge file', () => {
    const root = acmeRepository();
    const outside = fixture({ 'secret.md': '# not yours\n' });
    try {
      symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'docs', 'link.md'));
    } catch {
      return; // creating symbolic links needs a privilege some machines do not give
    }

    expect(() => call(root, 'read', { path: 'docs/link.md' })).toThrow(/symbolic link|escapes/u);
  });

  it('helps when the file does not exist, and when the line is past the end', () => {
    const root = acmeRepository();

    expect(() => call(root, 'read', { path: 'rules/99-none.md' })).toThrow(/does not exist/u);
    expect(() => call(root, 'read', { path: 'docs/guide.md', startLine: 99 })).toThrow(
      /past the end/u,
    );
    expect(() => call(root, 'read', { path: 'docs/guide.md', startLine: 3, endLine: 2 })).toThrow(
      /before startLine/u,
    );
    expect(() => call(root, 'read', { path: 'docs/guide.md', startLine: 0 })).toThrow(
      /counted from 1/u,
    );
    expect(() => call(root, 'read', {})).toThrow(/needs "path"/u);
  });

  it('accepts line numbers sent as numeric strings, as some models do', () => {
    const out = call(acmeRepository(), 'read', {
      path: 'rules/07-commit-rules.md',
      startLine: '5',
      endLine: '6',
    });

    expect(out).toContain('lines 5-6 of');
    expect(() =>
      call(acmeRepository(), 'read', { path: 'docs/guide.md', startLine: '1.5' }),
    ).toThrow(/counted from 1/u);
  });

  it('refuses a file over the size limit and redacts secrets in what it returns', () => {
    const root = acmeRepository();
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'big.md'), 'x'.repeat(2_100_000));

    expect(() => call(root, 'read', { path: 'docs/big.md' })).toThrow(/byte limit/u);
    expect(call(root, 'read', { path: 'rules/21-security-and-secrets.md' })).not.toContain(
      'hunter2hunter2',
    );
  });
});

describe('knowledge.context search', () => {
  it('ranks by filename, heading and terms, and points at line ranges', () => {
    const out = call(acmeRepository(), 'search', { query: 'prisma migration' });
    const first = out.split('\n').find((line) => line.startsWith('1.')) ?? '';

    expect(first).toMatch(/migration/u);
    expect(out).toMatch(/\.md:\d+-\d+/u);
  });

  it('searches knowledge files only: code that matches is never returned', () => {
    const out = call(acmeRepository(), 'search', { query: 'secretCode' });

    expect(out).not.toContain('index.ts');
    expect(out).toContain('No knowledge section matches');
  });

  it('never returns a whole large file: bounded snippets', () => {
    const root = fixture({ 'docs/big.md': huge(4_000), 'docs/small.md': '# Small\n\nfiller\n' });

    const out = call(root, 'search', { query: 'filler text section' });

    expect(out.length).toBeLessThanOrEqual(KNOWLEDGE_SEARCH_MAX_CHARS + 300);
  });

  it('clamps the hit count and rejects an empty query', () => {
    const root = acmeRepository();

    expect(
      call(root, 'search', { query: 'commit', limit: 1 })
        .split('\n')
        .filter((l) => /^\d+\./u.test(l)),
    ).toHaveLength(1);
    expect(() => call(root, 'search', { query: '  ' })).toThrow(/non-empty "query"/u);
    expect(() => call(root, 'search', { query: 'a'.repeat(300) })).toThrow(/at most 200/u);
  });

  it('redacts secrets that sit in a snippet', () => {
    const out = call(acmeRepository(), 'search', { query: 'password tokens logs' });

    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('password=[REDACTED]');
  });
});

describe('knowledge.context task', () => {
  it('names the root index section, the rule, the skill and the local instructions', () => {
    const out = call(acmeRepository(), 'task', {
      description: 'add a Prisma migration to chat-service; what ships in the same commit?',
    });

    expect(out).toContain('Read these first');
    expect(out).toMatch(/CLAUDE\.md.*Delivery checklist/u);
    expect(out).toContain('rules/52-every-schema-ships-a-migration.md');
    expect(out).toContain('skills/add-migration.md');
    expect(out).toContain('apps/acme-chat-service/CLAUDE.md');
    expect(out).not.toContain('apps/acme-billing-service');
    expect(out).toContain('rules/00-non-negotiable-rules.md');
  });

  it('keeps to its budget on a large repository', () => {
    const files: Record<string, string> = { 'CLAUDE.md': huge(1_700) };
    for (let index = 0; index < 120; index += 1) {
      files[`rules/${String(index).padStart(2, '0')}-migration-rule-${String(index)}.md`] =
        huge(200);
      files[`skills/migration-skill-${String(index)}.md`] = huge(100);
      files[`docs/migration-doc-${String(index)}.md`] = huge(100);
    }

    const out = call(fixture(files), 'task', { description: 'migration section filler' });

    expect(out.length).toBeLessThanOrEqual(KNOWLEDGE_TASK_MAX_CHARS + 120);
  });

  it('needs a description with words in it', () => {
    expect(() => call(acmeRepository(), 'task', {})).toThrow(/non-empty "description"/u);
    expect(() => call(acmeRepository(), 'task', { description: 'the and of' })).toThrow(
      /some words to match/u,
    );
  });
});

describe('knowledge.context misuse', () => {
  it('names the operations when the model invents one', () => {
    expect(() => call(acmeRepository(), 'write', { path: 'a.md' })).toThrow(
      /index, read, search, task/u,
    );
  });

  it('works on a workspace with no knowledge files at all', () => {
    const root = fixture({ 'src/a.ts': 'export {};\n' });

    expect(call(root, 'index')).toContain('0 knowledge files');
    expect(call(root, 'search', { query: 'anything' })).toContain('No knowledge section');
  });

  it('stops a walk when the run is cancelled', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      createKnowledgeTool(acmeRepository()).execute('index', {}, controller.signal),
    ).toThrow();
  });
});
