import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENT_TEAM_TOOL_NAME,
  AGENT_TEAM_TOOL_OPERATIONS,
} from '../../src/sdk/agent-team-tool.constants';
import { BROWSER_TOOL_NAME, BROWSER_TOOL_OPERATIONS } from '../../src/sdk/browser-tool.constants';
import { GATES_TOOL_OPERATIONS } from '../../src/sdk/code-gates.constants';
import { HTTP_TOOL_NAME, HTTP_TOOL_OPERATIONS } from '../../src/sdk/http-tool.constants';
import {
  KNOWLEDGE_TOOL_NAME,
  KNOWLEDGE_TOOL_OPERATIONS,
} from '../../src/sdk/knowledge-tool.constants';
import {
  PROCESS_WATCH_TOOL_NAME,
  PROCESS_WATCH_OPERATIONS,
} from '../../src/sdk/process-watch-tool.constants';
import { SHELL_TOOL_NAME, SHELL_TOOL_OPERATIONS } from '../../src/sdk/shell-tool.constants';
import { PLAN_TOOL_NAME, PLAN_TOOL_OPERATIONS } from '../../src/sdk/task-plan-tool.constants';
import {
  TOOLS_COVERED_ELSEWHERE,
  TOOL_PERMISSION_ROWS,
} from '../../src/sdk/tool-permission-table.constants';
import { VISION_TOOL_NAME, VISION_TOOL_OPERATIONS } from '../../src/sdk/vision-tool.constants';

import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

type Operations = Readonly<Record<string, AgentToolCategory>>;

/**
 * Every tool of the newer set and the operations it registers, taken from the
 * constants the tool itself is built from. A new tool adds its constant here AND
 * a row to the table, or a test below fails.
 */
const REGISTERED: Readonly<Record<string, Operations>> = {
  [AGENT_TEAM_TOOL_NAME]: AGENT_TEAM_TOOL_OPERATIONS,
  [BROWSER_TOOL_NAME]: BROWSER_TOOL_OPERATIONS,
  [HTTP_TOOL_NAME]: HTTP_TOOL_OPERATIONS,
  [KNOWLEDGE_TOOL_NAME]: KNOWLEDGE_TOOL_OPERATIONS,
  [PLAN_TOOL_NAME]: PLAN_TOOL_OPERATIONS,
  [PROCESS_WATCH_TOOL_NAME]: PROCESS_WATCH_OPERATIONS,
  [SHELL_TOOL_NAME]: SHELL_TOOL_OPERATIONS,
  [VISION_TOOL_NAME]: VISION_TOOL_OPERATIONS,
  'code.gates': GATES_TOOL_OPERATIONS,
};

const SDK_DIRECTORY = join(process.cwd(), 'src', 'sdk');
const rowKeys = new Set(
  TOOL_PERMISSION_ROWS.map((row) => `${row.tool}.${row.operation}@${row.category}`),
);

describe('a tool operation with no policy row fails', () => {
  it('every registered operation has a row in its own category', () => {
    const missing: string[] = [];
    for (const [tool, operations] of Object.entries(REGISTERED)) {
      for (const [operation, category] of Object.entries(operations)) {
        if (!rowKeys.has(`${tool}.${operation}@${category}`)) {
          missing.push(`${tool}.${operation} [${category}]`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every row names a registered operation (no row outlives its tool)', () => {
    const known = new Set([
      ...Object.entries(REGISTERED).flatMap(([tool, operations]) =>
        Object.keys(operations).map((operation) => `${tool}.${operation}`),
      ),
      'workspace.command.run',
    ]);
    const stale = TOOL_PERMISSION_ROWS.filter(
      (row) => !known.has(`${row.tool}.${row.operation}`),
    ).map((row) => `${row.tool}.${row.operation}`);
    expect(stale).toEqual([]);
  });

  it('http.request has a row for both of its categories', () => {
    expect(rowKeys.has('http.request.request@http')).toBe(true);
    expect(rowKeys.has('http.request.request@http-write')).toBe(true);
  });

  it('every tool the SDK source names is registered here or covered by an older test', () => {
    const named = new Set<string>();
    for (const file of readdirSync(SDK_DIRECTORY).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(SDK_DIRECTORY, file), 'utf8');
      for (const match of source.matchAll(/\b[A-Z_]+_TOOL_NAME\s*=\s*'([a-z]+\.[a-z]+)'/gu)) {
        named.add(match[1] ?? '');
      }
      for (const match of source.matchAll(/^\s+name:\s*'([a-z]+\.[a-z]+)',/gmu)) {
        named.add(match[1] ?? '');
      }
    }
    const covered = new Set([
      ...Object.keys(REGISTERED),
      ...TOOLS_COVERED_ELSEWHERE,
      // The command tool is in the table as the reference row for what "runs local work" means.
      'workspace.command',
    ]);
    expect([...named].filter((tool) => !covered.has(tool)).sort()).toEqual([]);
  });

  it('every operation table the SDK exports is registered here', () => {
    const exported = new Set<string>();
    for (const file of readdirSync(SDK_DIRECTORY).filter((name) =>
      name.endsWith('.constants.ts'),
    )) {
      const source = readFileSync(join(SDK_DIRECTORY, file), 'utf8');
      for (const match of source.matchAll(
        /export const (\w+_OPERATIONS): (?:Readonly<Record<[^>]*AgentToolCategory>>)/gu,
      )) {
        exported.add(match[1] ?? '');
      }
    }
    const registered = new Set([
      'AGENT_TEAM_TOOL_OPERATIONS',
      'BROWSER_TOOL_OPERATIONS',
      'HTTP_TOOL_OPERATIONS',
      'KNOWLEDGE_TOOL_OPERATIONS',
      'PLAN_TOOL_OPERATIONS',
      'PROCESS_WATCH_OPERATIONS',
      'SHELL_TOOL_OPERATIONS',
      'VISION_TOOL_OPERATIONS',
      'GATES_TOOL_OPERATIONS',
      // Older tools, covered by sdk-permission-policy-modes.test.ts.
      'FILE_TOOL_OPERATIONS',
      'GIT_TOOL_OPERATIONS',
      'NOTES_TOOL_OPERATIONS',
      'COMMAND_TOOL_OPERATIONS',
    ]);
    expect([...exported].filter((name) => !registered.has(name)).sort()).toEqual([]);
  });
});
