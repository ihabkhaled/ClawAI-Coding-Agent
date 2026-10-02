import { GATE_MAX_MESSAGE_CHARS } from './code-gates.constants';

/** One compiler, linter or formatter finding. */
export interface Problem {
  readonly severity: 'error' | 'warning';
  readonly text: string;
}

const TSC_PAREN = /^([^\s"'>][^"']*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/u;
const TSC_COLON = /^([^\s"'>][^"']*?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.*)$/u;
const ESLINT_LINE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([@\w/.-]+))?\s*$/u;
const ESLINT_SUMMARY = /^\s*[✖x]\s+\d+\s+problems?/u;
const PRETTIER_WARN = /^\[warn\]\s+(\S.*)$/u;
const PRETTIER_ERROR = /^\[error\]\s+(\S.*)$/u;
const PRETTIER_NOISE =
  /(?:Code style issues|Forgot to run Prettier|Checking formatting|All matched files)/u;
const CARGO_HEAD = /^(error|warning)(?:\[(\w+)\])?:\s+(.*)$/u;
const CARGO_AT = /^\s*-->\s+(\S+?):(\d+):(\d+)/u;
const CARGO_NOISE =
  /(?:could not compile|aborting due|warnings? emitted|generated \d+ warning|test failed|build failed)/u;
const GO_LINE = /^(\S+\.go):(\d+):(?:(\d+):)?\s+(.*)$/u;
const PY_MYPY = /^(\S+\.pyi?):(\d+):\s+(error|warning):\s+(.*)$/u;
const PY_RUFF = /^(\S+\.pyi?):(\d+):(\d+):\s+([A-Z]+\d+)\s+(.*)$/u;

function cut(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length <= GATE_MAX_MESSAGE_CHARS
    ? flat
    : `${flat.slice(0, GATE_MAX_MESSAGE_CHARS - 1)}…`;
}

function severityOf(word: string | undefined): 'error' | 'warning' {
  return word === 'warning' ? 'warning' : 'error';
}

function tscProblem(line: string): Problem | undefined {
  const match = TSC_PAREN.exec(line) ?? TSC_COLON.exec(line);
  if (match === null) return undefined;
  const [, file = '', row = '', col = '', severity, code = '', message = ''] = match;
  return {
    severity: severityOf(severity),
    text: cut(`${file}:${row}:${col} ${code} ${message}`),
  };
}

/** eslint's stylish format: a file name line, then `line:col  severity  message  rule` lines. */
function eslintProblems(lines: readonly string[]): readonly Problem[] {
  const problems: Problem[] = [];
  let file = '';
  for (const line of lines) {
    const match = ESLINT_LINE.exec(line);
    if (match !== null) {
      const [, row = '', col = '', severity, message = '', rule] = match;
      const suffix = rule === undefined ? '' : ` (${rule})`;
      problems.push({
        severity: severityOf(severity),
        text: cut(`${file}:${row}:${col} ${message}${suffix}`),
      });
    } else if (/^\S/u.test(line) && !ESLINT_SUMMARY.test(line) && !line.startsWith('[')) {
      file = line.trim();
    }
  }
  return problems;
}

interface EslintJsonMessage {
  readonly line?: number;
  readonly column?: number;
  readonly severity?: number;
  readonly message?: string;
  readonly ruleId?: string | null;
}

function jsonMessages(value: unknown): readonly Problem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as { filePath?: unknown; messages?: unknown };
    if (typeof record.filePath !== 'string' || !Array.isArray(record.messages)) return [];
    const file = record.filePath;
    return (record.messages as EslintJsonMessage[]).map((item) => ({
      severity: item.severity === 1 ? ('warning' as const) : ('error' as const),
      text: cut(
        `${file}:${String(item.line ?? 0)}:${String(item.column ?? 0)} ${item.message ?? ''}${
          item.ruleId === undefined || item.ruleId === null ? '' : ` (${item.ruleId})`
        }`,
      ),
    }));
  });
}

/** `eslint --format json` output, when the whole text is that JSON array. */
function eslintJson(output: string): readonly Problem[] | undefined {
  const trimmed = output.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;
  try {
    return jsonMessages(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function prettierProblems(lines: readonly string[]): readonly Problem[] {
  const problems: Problem[] = [];
  for (const line of lines) {
    const warn = PRETTIER_WARN.exec(line)?.[1];
    if (warn !== undefined && !PRETTIER_NOISE.test(warn)) {
      problems.push({ severity: 'error', text: cut(`${warn} is not formatted`) });
      continue;
    }
    const error = PRETTIER_ERROR.exec(line)?.[1];
    if (error !== undefined && !PRETTIER_NOISE.test(error)) {
      problems.push({ severity: 'error', text: cut(error) });
    }
  }
  return problems;
}

function cargoProblems(lines: readonly string[]): readonly Problem[] {
  const problems: Problem[] = [];
  for (const [index, line] of lines.entries()) {
    const head = CARGO_HEAD.exec(line);
    if (head === null || CARGO_NOISE.test(line)) continue;
    const at = lines
      .slice(index + 1, index + 4)
      .map((next) => CARGO_AT.exec(next))
      .find(Boolean);
    const place =
      at === null || at === undefined ? '' : `${at[1] ?? ''}:${at[2] ?? ''}:${at[3] ?? ''} `;
    const code = head[2] === undefined ? '' : `${head[2]} `;
    problems.push({
      severity: severityOf(head[1]),
      text: cut(`${place}${code}${head[3] ?? ''}`),
    });
  }
  return problems;
}

function goProblem(line: string): Problem | undefined {
  const go = GO_LINE.exec(line);
  if (go === null) return undefined;
  return { severity: 'error', text: cut(`${go[1] ?? ''}:${go[2] ?? ''} ${go[4] ?? ''}`) };
}

function mypyProblem(line: string): Problem | undefined {
  const mypy = PY_MYPY.exec(line);
  if (mypy === null) return undefined;
  return {
    severity: severityOf(mypy[3]),
    text: cut(`${mypy[1] ?? ''}:${mypy[2] ?? ''} ${mypy[4] ?? ''}`),
  };
}

function ruffProblem(line: string): Problem | undefined {
  const ruff = PY_RUFF.exec(line);
  if (ruff === null) return undefined;
  return {
    severity: 'error',
    text: cut(
      `${ruff[1] ?? ''}:${ruff[2] ?? ''}:${ruff[3] ?? ''} ${ruff[4] ?? ''} ${ruff[5] ?? ''}`,
    ),
  };
}

function lineProblems(lines: readonly string[]): readonly Problem[] {
  return lines.flatMap((line) => goProblem(line) ?? mypyProblem(line) ?? ruffProblem(line) ?? []);
}

/** Every compiler, linter and formatter finding in a command's output. */
export function parseProblems(output: string): readonly Problem[] {
  const json = eslintJson(output);
  if (json !== undefined) return json;
  const lines = output.split(/\r?\n/u);
  const tsc = lines.flatMap((line) => tscProblem(line) ?? []);
  return [
    ...tsc,
    ...eslintProblems(lines),
    ...prettierProblems(lines),
    ...cargoProblems(lines),
    ...lineProblems(lines),
  ];
}
