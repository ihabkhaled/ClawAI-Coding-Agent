import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const created: string[] = [];

/** Removes every fixture a test made. */
export function cleanFixtures(): void {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
}

/** Writes `files` (relative path to text) into a fresh temporary workspace and returns its root. */
export function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'claw-knowledge-'));
  created.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

export const ROOT_CLAUDE = [
  '# Acme policy',
  '',
  'Root index for every agent.',
  '',
  '## Absolute prohibitions',
  '',
  '- NEVER bypass a git hook.',
  '- NEVER cross a service database boundary.',
  '- NEVER log a secret.',
  '',
  '## Delivery checklist',
  '',
  'A schema change ships its Prisma migration in the same commit: see [rule 52](rules/52-every-schema-ships-a-migration.md).',
  '',
  '## Where everything lives',
  '',
  '| You need | Go to |',
  '| --- | --- |',
  '| Commits | [rules/07-commit-rules.md](rules/07-commit-rules.md) |',
  '',
].join('\n');

/** A small monorepo with the usual knowledge layout and files that must never be read. */
export function acmeRepository(): string {
  return fixture({
    'CLAUDE.md': ROOT_CLAUDE,
    'AGENTS.md': '# Agents\n\nRead CLAUDE.md first.\n',
    '.gitignore': 'ignored/\n*.private.md\n.env\n',
    'rules/00-non-negotiable-rules.md':
      '# Non-negotiable\n\n- No console.log.\n- No secrets in logs.\n',
    'rules/52-every-schema-ships-a-migration.md':
      '# Rule 52 - every schema ships a migration\n\n## Mandatory\n\nA Prisma schema change commits its migration folder in the same commit.\n',
    'rules/07-commit-rules.md':
      '# Commit rules\n\n## Chunking\n\nOne commit, one push.\n\n## Hooks\n\nNever skip a hook.\n',
    'rules/21-security-and-secrets.md':
      '# Security\n\nKeep tokens out of logs. password=hunter2hunter2 must never appear.\n',
    'skills/add-migration.md':
      '---\nname: add-migration\ndescription: Add a Prisma migration to a service\n---\n\n# Add a migration\n\nRun prisma migrate dev.\n',
    'skills/add-a-banner.md': '# Add a banner\n\nFrontend only.\n',
    'context/stack.md': '# Stack\n\nNode and Prisma.\n',
    'docs/guide.md': '# Guide\n\nWelcome.\n',
    'apps/acme-chat-service/CLAUDE.md': '# chat-service\n\nOwns the chat tables.\n',
    'apps/acme-billing-service/CLAUDE.md': '# billing-service\n\nOwns the invoices.\n',
    'src/index.ts': 'export const secretCode = 1;\n',
    'package.json': '{"name":"acme"}\n',
    '.env': 'API_KEY=sk-abcdefghijklmnopqrstuvwx\n',
    'node_modules/pkg/README.md': '# pkg readme must not be indexed\n',
    'dist/notes.md': '# dist notes must not be indexed\n',
    'ignored/private.md': '# ignored dir must not be indexed\n',
    'docs/plan.private.md': '# ignored by pattern\n',
    '.ai/manifests/skills.json': '{"skills":["add-migration"]}\n',
  });
}
