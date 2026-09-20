import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execPath } from 'node:process';

/**
 * What a coding agent has to be able to do, as runnable rounds.
 *
 * Each scenario owns three things and nothing else: the workspace it starts
 * from, the prompt a person would actually type, and an assertion that reads
 * the workspace afterwards. No assertion reads the model's answer, the tool
 * log, or the run's own receipts — a run that reports success and leaves an
 * empty directory must fail here, and that is the only failure worth catching.
 *
 * The command runner is unrestricted, so git, node and npm rounds need no
 * extra tool: choosing the right executable is part of what is being tested.
 */
const node = (workspace, file) =>
  spawnSync(execPath, [file], { cwd: workspace, encoding: 'utf8', timeout: 30_000 });

const git = (workspace, args) =>
  spawnSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: 30_000 });

const read = (workspace, file) =>
  existsSync(path.join(workspace, file)) ? readFileSync(path.join(workspace, file), 'utf8') : '';

export const LIVE_ROUND_SCENARIOS = [
  {
    key: 'read-workspace',
    title: 'reads a file and reports what is in it',
    files: {
      'NOTES.md': '# Notes\n\nThe deployment token rotates every 37 days.\n',
    },
    prompt: [
      'Read NOTES.md in this workspace with the workspace.file tool, operation "read".',
      'Then create ANSWER.txt with workspace.file operation "create", containing only',
      'the number of days the deployment token rotates in. Digits only, nothing else.',
    ].join(' '),
    assert: (workspace) => {
      const answer = read(workspace, 'ANSWER.txt').trim();
      return { ok: answer === '37', detail: `ANSWER.txt=${JSON.stringify(answer)}` };
    },
  },
  {
    key: 'write-exact',
    title: 'writes a file with exactly the requested content',
    files: { 'README.md': '# Scratch\n' },
    prompt: [
      'Create a file named VERSION with workspace.file operation "create".',
      'Its entire content must be exactly: 2.4.1',
      'Do not add a newline, a comment, or any other text. Then reply DONE.',
    ].join(' '),
    assert: (workspace) => {
      const value = read(workspace, 'VERSION').trim();
      return { ok: value === '2.4.1', detail: `VERSION=${JSON.stringify(value)}` };
    },
  },
  {
    key: 'edit-existing',
    title: 'edits an existing file instead of replacing the project',
    files: {
      'config.js': 'module.exports = { retries: 1, timeoutMs: 1000, verbose: false };\n',
      'KEEP.md': '# Keep me\n',
    },
    prompt: [
      'Read config.js, then change only the retries value from 1 to 5 and write the',
      'file back with workspace.file operation "create". Leave timeoutMs and verbose',
      'exactly as they are, and do not delete any other file. Reply DONE when finished.',
    ].join(' '),
    assert: (workspace) => {
      const config = read(workspace, 'config.js');
      const kept = read(workspace, 'KEEP.md').length > 0;
      const ok = /retries:\s*5/u.test(config) && /timeoutMs:\s*1000/u.test(config) && kept;
      return { ok, detail: `config=${config.trim().slice(0, 80)} keep=${String(kept)}` };
    },
  },
  {
    key: 'run-command',
    title: 'runs a command and acts on its output',
    files: {
      'sum.js': 'const total = [1, 2, 3, 4].reduce((a, b) => a + b, 0);\nconsole.log(total);\n',
    },
    prompt: [
      'Run sum.js with the workspace.command tool: executable "node", arguments ["sum.js"].',
      'Then create RESULT.txt with workspace.file operation "create" containing only the',
      'number the program printed. Digits only. Reply DONE.',
    ].join(' '),
    assert: (workspace) => {
      const result = read(workspace, 'RESULT.txt').trim();
      return { ok: result === '10', detail: `RESULT.txt=${JSON.stringify(result)}` };
    },
  },
  {
    key: 'git-commit',
    title: 'initialises a repository and lands a real commit',
    files: { 'app.js': 'console.log("start");\n' },
    prompt: [
      'Use the workspace.command tool to run git in this workspace.',
      'Run: git init ; git config user.email agent@claw.test ; git config user.name Agent ;',
      'git add -A ; git commit -m "chore: initial commit".',
      'Each is a separate workspace.command call with executable "git".',
      'Reply DONE when the commit exists.',
    ].join(' '),
    assert: (workspace) => {
      const log = git(workspace, ['log', '--oneline', '-1']);
      const ok = (log.stdout ?? '').includes('initial commit');
      return { ok, detail: `git log=${(log.stdout ?? log.stderr ?? '').trim().slice(0, 80)}` };
    },
  },
  {
    key: 'deliver-feature',
    title: 'delivers a feature end to end: code, test, and a passing run',
    files: {
      'README.md': '# Currency kata\n\nA tiny Node.js project.\n',
    },
    prompt: [
      'Build a small feature end to end in this Node.js workspace.',
      '1) Create money.js exporting formatMinorUnits(amount, currency) via module.exports.',
      '   It formats integer minor units as a decimal string with two places, e.g.',
      '   formatMinorUnits(1234, "USD") returns "USD 12.34".',
      '2) Create money.test.js that requires ./money, checks that case with assert,',
      '   and prints "TESTS PASS" when every assertion holds.',
      '3) Run it with workspace.command: executable "node", arguments ["money.test.js"].',
      '4) If it does not print TESTS PASS, fix the code and run it again.',
      'Reply DONE only once the test run printed TESTS PASS.',
    ].join(' '),
    assert: (workspace) => {
      const run = node(workspace, 'money.test.js');
      const ok = (run.stdout ?? '').includes('TESTS PASS');
      return {
        ok,
        detail: `exit=${String(run.status)} out=${(run.stdout ?? run.stderr ?? '').trim().slice(0, 80)}`,
      };
    },
  },
  {
    key: 'apply-markdown-plan',
    title: 'applies a plan written as markdown',
    files: {
      'PLAN.md': [
        '# Plan',
        '',
        '- [ ] Create `src/slug.js` exporting `slugify(text)` via `module.exports`.',
        '  It lowercases, replaces every run of non-alphanumeric characters with a',
        '  single hyphen, and trims hyphens from both ends.',
        '- [ ] Create `src/slug.check.js` that requires `./slug` and prints',
        '  `slugify("Hello, World!")`.',
        '- [ ] Run `node src/slug.check.js`.',
        '',
      ].join('\n'),
    },
    prompt: [
      'Read PLAN.md with workspace.file operation "read" and carry out every step in it,',
      'exactly as written, using the tools provided. Reply DONE when the plan is done.',
    ].join(' '),
    assert: (workspace) => {
      const run = node(workspace, 'src/slug.check.js');
      const ok = (run.stdout ?? '').trim() === 'hello-world';
      return {
        ok,
        detail: `slug=${JSON.stringify((run.stdout ?? run.stderr ?? '').trim().slice(0, 60))}`,
      };
    },
  },
  {
    key: 'fix-failing-test',
    title: 'diagnoses a failing test and repairs the code',
    files: {
      'math.js': 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
      'math.test.js': [
        "const assert = require('node:assert/strict');",
        "const { add } = require('./math');",
        'assert.equal(add(2, 3), 5);',
        "console.log('TESTS PASS');",
        '',
      ].join('\n'),
    },
    prompt: [
      'Run math.test.js with workspace.command: executable "node", arguments ["math.test.js"].',
      'It fails. Read the files, fix the bug in math.js only, and run the test again.',
      'Do not change math.test.js. Reply DONE once the test prints TESTS PASS.',
    ].join(' '),
    assert: (workspace) => {
      const run = node(workspace, 'math.test.js');
      const spec = read(workspace, 'math.test.js');
      const untouched = spec.includes('add(2, 3), 5');
      const ok = (run.stdout ?? '').includes('TESTS PASS') && untouched;
      return { ok, detail: `exit=${String(run.status)} specKept=${String(untouched)}` };
    },
  },
  {
    key: 'multi-file',
    title: 'creates several files that work together',
    files: { 'README.md': '# Pipeline\n' },
    prompt: [
      'Create three files that work together in this Node.js workspace:',
      'lib/parse.js exporting parse(csvText) returning an array of row objects for a',
      'header line plus rows; lib/report.js exporting count(rows) returning rows.length;',
      'and main.js which requires both, parses "a,b\\n1,2\\n3,4" and prints the count.',
      'Then run main.js with workspace.command and make sure it prints 2. Reply DONE.',
    ].join(' '),
    assert: (workspace) => {
      const run = node(workspace, 'main.js');
      const files = readdirSync(workspace);
      const ok = (run.stdout ?? '').trim() === '2';
      return {
        ok,
        detail: `out=${(run.stdout ?? run.stderr ?? '').trim().slice(0, 60)} files=${files.join(',')}`,
      };
    },
  },
  {
    key: 'refuse-outside-workspace',
    title: 'stays inside the workspace when asked to leave it',
    files: { 'README.md': '# Contained\n' },
    prompt: [
      'Create a file named notes.txt containing the word contained.',
      'Put it in this workspace. Then reply DONE.',
    ].join(' '),
    assert: (workspace) => {
      const inside = read(workspace, 'notes.txt').toLowerCase().includes('contained');
      return { ok: inside, detail: `notes.txt inside workspace=${String(inside)}` };
    },
  },
];
