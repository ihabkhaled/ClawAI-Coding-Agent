import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, cwd, exit, stdout } from 'node:process';

import { format, resolveConfig } from 'prettier';

/**
 * Generates the surface inventory `docs/RULES.md` rule 6 requires.
 *
 * Rule 1 says a command, setting, view or tool is delivered only when a
 * reachable call path and a test demonstrate it. That cannot be tracked in a
 * hand-written table, because a hand-written table falls behind the manifest
 * the first time someone adds a command and forgets the row. So the rows are
 * generated from `package.json` and the tool definitions themselves, and the
 * table can never claim a surface the product does not contribute.
 *
 * Two columns are computed and two are not, deliberately:
 *
 * - **Call path** is computed. Whether an identifier is referenced anywhere in
 *   `src/` outside its own declaration is a fact about the tree, and it is the
 *   fact rule 1 turns on. A contributed command nothing registers is dormant,
 *   and the generator says so without anyone having to notice.
 * - **Status and evidence** are preserved from the existing file. They record
 *   what a human or a lane observed, and regenerating must never erase an
 *   observation. A brand-new row starts at NOT RUN, which is the honest value
 *   before anything has been run.
 *
 * `--check` fails when the table and the manifest disagree, so the gate catches
 * a new command that never got a row.
 */
const root = cwd();
const OUTPUT = join('docs', 'parity', 'SURFACE_INVENTORY.md');
const SETTING_PREFIX = 'clawAI.';

function filesUnder(rootDirectory) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.ts')) files.push(relative);
    }
  };
  walk(rootDirectory);
  return files.map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

/**
 * Where an identifier is referenced, ignoring the file that declares it.
 *
 * A declaration referencing itself proves nothing; the question is whether
 * anything else reaches it.
 */
function referenceOf(files, needle, declaredIn) {
  for (const file of files) {
    if (file.path === declaredIn) continue;
    const index = file.text.indexOf(needle);
    if (index === -1) continue;
    const line = file.text.slice(0, index).split('\n').length;
    return `${file.path}:${line}`;
  }
  return undefined;
}

/**
 * A surface only tests reach is not shipped, and saying so is the point.
 *
 * Rule 1 draws the line at a reachable call path in the product. A definition
 * exercised solely by a spec is a fixture, and labelling it that way stops it
 * being counted as a delivered tool.
 */
function testOnly(reference) {
  return reference === undefined ? undefined : `test-only (${reference})`;
}

function toolRows(files, testFiles) {
  const rows = [];
  for (const file of files) {
    const pattern = /export const (\w+): ToolDefinition = \{/gu;
    let match;
    while ((match = pattern.exec(file.text)) !== null) {
      const block = file.text.slice(match.index, match.index + 4_000);
      const name = /\bname: '([^']+)'/u.exec(block)?.[1] ?? match[1];
      const operations = /operations: \[([^\]]*)\]/u.exec(block)?.[1] ?? '';
      const count = operations.split(',').filter((entry) => entry.trim().length > 0).length;
      // The executor class, not the definition. A test that imports a definition
      // may only be building a fixture; a test that reaches the executor is the
      // one exercising what the tool actually does.
      const executor = /export class (\w+) implements RuntimeToolExecutorPort/u.exec(
        file.text,
      )?.[1];
      rows.push({
        surface: 'Runtime tool',
        id: name,
        detail: `${String(count)} operation(s)`,
        callPath:
          referenceOf(files, match[1], file.path) ??
          testOnly(referenceOf(testFiles, match[1], file.path)),
        test: executor === undefined ? undefined : referenceOf(testFiles, executor, file.path),
      });
    }
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function manifestRows(manifest, files, testFiles) {
  const contributes = manifest.contributes ?? {};
  const rows = [];

  for (const command of contributes.commands ?? []) {
    rows.push({
      surface: 'Command',
      id: command.command,
      detail: command.title ?? '',
      callPath: referenceOf(files, `'${command.command}'`, ''),
      test: referenceOf(testFiles, `'${command.command}'`, ''),
    });
  }

  for (const key of Object.keys(contributes.configuration?.properties ?? {})) {
    rows.push({
      surface: 'Setting',
      id: key,
      detail: String(contributes.configuration.properties[key].type ?? ''),
      // Settings are read through the configuration service by their suffix,
      // never by the fully qualified key, so the suffix is what to look for.
      callPath: referenceOf(files, `'${key.replace(SETTING_PREFIX, '')}'`, ''),
      test: referenceOf(testFiles, `'${key.replace(SETTING_PREFIX, '')}'`, ''),
    });
  }

  for (const [container, views] of Object.entries(contributes.views ?? {})) {
    for (const view of views) {
      rows.push({
        surface: 'View',
        id: view.id,
        detail: `${container}: ${view.name ?? ''}`,
        callPath: referenceOf(files, `'${view.id}'`, ''),
        test: referenceOf(testFiles, `'${view.id}'`, ''),
      });
    }
  }

  for (const binding of contributes.keybindings ?? []) {
    rows.push({
      surface: 'Keybinding',
      id: `${binding.key} -> ${binding.command}`,
      detail: binding.when ?? '',
      callPath: referenceOf(files, `'${binding.command}'`, ''),
      test: referenceOf(testFiles, `'${binding.command}'`, ''),
    });
  }

  return rows;
}

/**
 * Existing lane, status and evidence, so regenerating never erases an
 * observation.
 *
 * Columns are located by reading the header rather than by counting from the
 * left. Adding a column once shifted every recorded status one place and
 * silently rewrote the ledger, which is the exact failure this file exists to
 * prevent.
 */
function existingObservations() {
  const observations = new Map();
  let text;
  try {
    text = readFileSync(join(root, OUTPUT), 'utf8');
  } catch {
    return observations;
  }
  const rows = text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  // Identified by what it contains, not where it sits, so a column added at
  // either end still resolves.
  const header = rows.find(
    (cell) => cell.includes('Identifier') && cell.includes('Status') && cell.includes('Evidence'),
  );
  if (header === undefined) return observations;
  const at = (label) => header.indexOf(label);
  const [id, lane, status, evidence] = ['Identifier', 'Lane', 'Status', 'Evidence'].map(at);
  if ([id, lane, status, evidence].some((index) => index === -1)) return observations;

  for (const cell of rows) {
    if (cell === header || cell.length !== header.length) continue;
    if (cell[0] === undefined || cell[0].startsWith('---')) continue;
    observations.set(cell[id], {
      lane: cell[lane],
      status: cell[status],
      evidence: cell[evidence],
    });
  }
  return observations;
}

function render(rows, observations) {
  const counts = { 'NOT RUN': 0, PASS: 0, FAIL: 0, BLOCKED: 0 };
  const dormant = rows.filter((row) => row.callPath === undefined).length;
  const untested = rows.filter((row) => row.test === undefined).length;
  const body = rows
    .map((row) => {
      const seen = observations.get(row.id) ?? {};
      const status = seen.status && seen.status.length > 0 ? seen.status : 'NOT RUN';
      counts[status] = (counts[status] ?? 0) + 1;
      const path = row.callPath ?? '**none found**';
      const lane = seen.lane && seen.lane.length > 0 ? seen.lane : '—';
      const evidence = seen.evidence && seen.evidence.length > 0 ? seen.evidence : '—';
      const test = row.test ?? '**none**';
      return `| ${row.surface} | ${row.id} | ${row.detail} | ${path} | ${test} | ${lane} | ${status} | ${evidence} |`;
    })
    .join('\n');

  return `# Surface inventory

Generated by \`npm run inventory:surface\`. Do not edit the generated columns by
hand — edit the lane, status and evidence columns only, and they survive
regeneration.

\`docs/RULES.md\` rule 6 requires a row for every command, setting, view,
keybinding and tool, each carrying PASS, FAIL, BLOCKED or NOT RUN with evidence.
Rule 1 is why the call-path column exists: a surface nothing references is
dormant, and dormant code is not a feature.

**A status is an observation, not an intention.** NOT RUN is the correct value
until a lane has actually exercised the row, and most rows start there.

## Totals

| Measure | Count |
| --- | --- |
| Rows | ${String(rows.length)} |
| No call path found | ${String(dormant)} |
| No test found | ${String(untested)} |
| PASS | ${String(counts.PASS)} |
| FAIL | ${String(counts.FAIL)} |
| BLOCKED | ${String(counts.BLOCKED)} |
| NOT RUN | ${String(counts['NOT RUN'])} |

## Rows

| Surface | Identifier | Detail | Call path | Test | Lane | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
${body}
`;
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const files = filesUnder('src');
const testFiles = filesUnder('tests');
const rows = [...manifestRows(manifest, files, testFiles), ...toolRows(files, testFiles)];

// Formatted here rather than left for `format:check` to rewrite afterwards.
// A generated file the formatter then edits can never satisfy its own drift
// check: the tree would hold one text and the generator would produce another,
// and the two gates would disagree forever.
const output = await format(render(rows, existingObservations()), {
  ...(await resolveConfig(join(root, OUTPUT))),
  parser: 'markdown',
});

if (argv.includes('--check')) {
  let current;
  try {
    current = readFileSync(join(root, OUTPUT), 'utf8');
  } catch {
    stdout.write(
      `inventory:surface FAILED — ${OUTPUT} does not exist. Run npm run inventory:surface.\n`,
    );
    exit(1);
  }
  if (current !== output) {
    stdout.write(
      `inventory:surface FAILED — ${OUTPUT} is stale. A contributed surface has no row, or a row has no surface. Run npm run inventory:surface.\n`,
    );
    exit(1);
  }
  stdout.write(`inventory:surface OK — ${String(rows.length)} rows match the manifest.\n`);
  exit(0);
}

writeFileSync(join(root, OUTPUT), output, 'utf8');
stdout.write(`inventory:surface wrote ${String(rows.length)} rows to ${OUTPUT}.\n`);
