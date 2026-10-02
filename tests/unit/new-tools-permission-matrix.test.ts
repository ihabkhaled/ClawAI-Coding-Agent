import { describe, expect, it } from 'vitest';

import { classifiedOperation } from '../../src/core/runtime/runtime-operation-classification';
import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { narrowGrant } from '../../src/sdk/agent-team-narrow';
import { decisionFor, needsApproval, permissionsForMode } from '../../src/sdk/permission-modes';
import {
  AGENT_PERMISSION_MODES,
  AGENT_PLAN_TOOL_CATEGORIES,
} from '../../src/sdk/permission-modes.constants';
import {
  HTTP_WRITE_CLASSIFICATION,
  TOOL_PERMISSION_ROWS,
} from '../../src/sdk/tool-permission-table.constants';

import type { SpawnRequest } from '../../src/sdk/agent-team-tool.types';
import type { AgentPermissionMode } from '../../src/sdk/permission-modes.types';
import type { ToolDecision, ToolPermissionRow } from '../../src/sdk/tool-permission-table.types';
import type {
  AgentApprovalRequest,
  AgentToolCategory,
} from '../../src/sdk/workspace-toolkit.types';

const ALL_CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'mcp',
  'http',
  'http-write',
  'browser',
  'shell',
  'agents',
];
const SPAWN: SpawnRequest = {
  name: 'kid',
  task: 'x',
  model: undefined,
  tools: undefined,
  writeScope: undefined,
  maxToolCalls: undefined,
  maxDurationSec: undefined,
  workspaceSubdir: undefined,
  isolation: 'none',
};
const SEVERITY: Readonly<Record<ToolDecision, number>> = { allow: 0, ask: 1, deny: 2 };

const requestOf = (row: ToolPermissionRow): AgentApprovalRequest => ({
  toolName: row.tool,
  operation: row.operation,
  arguments: {},
  category: row.category,
});
const label = (row: ToolPermissionRow): string => `${row.tool}.${row.operation} [${row.category}]`;
const classificationOf = (row: ToolPermissionRow) =>
  row.classification ?? classifiedOperation(row.tool, row.operation);

describe('the permission table covers every mode', () => {
  it('names a decision for each of the five modes in every row', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      expect(Object.keys(row.decisions).sort(), label(row)).toEqual(
        [...AGENT_PERMISSION_MODES].sort(),
      );
    }
  });

  it('has no row twice', () => {
    const keys = TOOL_PERMISSION_ROWS.map((row) => label(row));
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });
});

describe.each(AGENT_PERMISSION_MODES)('%s over every new tool operation', (mode) => {
  it('decides exactly what the table says', () => {
    const wrong = TOOL_PERMISSION_ROWS.filter(
      (row) => decisionFor(mode, requestOf(row)) !== row.decisions[mode],
    ).map(label);
    expect(wrong).toEqual([]);
  });

  it('puts a call to the approver exactly when the table says ask', () => {
    const wrong = TOOL_PERMISSION_ROWS.filter(
      (row) => needsApproval(mode, requestOf(row)) !== (row.decisions[mode] === 'ask'),
    ).map(label);
    expect(wrong).toEqual([]);
  });

  it('runs the approval callback only for ask, and only an exact true approves', async () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      if (mode === 'plan') continue;
      const asked: string[] = [];
      const grants = permissionsForMode(mode, {
        allow: ALL_CATEGORIES,
        approve: (request) => {
          asked.push(request.toolName);
          return true;
        },
      });
      const answer = await grants.approve?.(requestOf(row));
      const decision = row.decisions[mode];
      expect(answer, label(row)).toBe(decision !== 'deny');
      expect(asked.length, label(row)).toBe(decision === 'ask' ? 1 : 0);

      const refusing = permissionsForMode(mode, { allow: ALL_CATEGORIES, approve: () => false });
      expect(await refusing.approve?.(requestOf(row)), label(row)).toBe(decision === 'allow');
      const silent = permissionsForMode(mode, { allow: ALL_CATEGORIES });
      expect(await silent.approve?.(requestOf(row)), label(row)).toBe(decision === 'allow');
    }
  });
});

describe('plan', () => {
  const plan = permissionsForMode('plan', { allow: ALL_CATEGORIES });

  it('keeps exactly read, git and http', () => {
    expect(plan.allow).toEqual(['read', 'git', 'http']);
    expect(plan.approve).toBeUndefined();
  });

  it('refuses a row exactly when its category is withheld', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      const offered = plan.allow.includes(row.category);
      expect(row.decisions.plan, label(row)).toBe(offered ? 'allow' : 'deny');
    }
  });

  it('only ever offers a read-class operation', () => {
    for (const row of TOOL_PERMISSION_ROWS.filter((item) => item.decisions.plan === 'allow')) {
      expect(AGENT_PLAN_TOOL_CATEGORIES).toContain(row.category);
      expect(classificationOf(row)?.effect, label(row)).toBe('read');
    }
  });
});

describe('what no unattended mode may run', () => {
  const NEVER_UNASKED = new Set(['network-write', 'publication', 'destructive', 'elevation']);

  it('autonomous-scoped asks for every R3+ class operation and everything on the shell', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      const classification = classificationOf(row);
      expect(classification, `${label(row)} has no classification`).toBeDefined();
      const reaches =
        NEVER_UNASKED.has(classification?.effect ?? '') ||
        classification?.risk === 'R3' ||
        classification?.risk === 'R4' ||
        row.category === 'shell' ||
        row.category === 'http-write';
      if (reaches) expect(row.decisions['autonomous-scoped'], label(row)).toBe('ask');
    }
  });

  it('every network write and shell script is asked in ask, accept-edits and strict too', () => {
    const rows = TOOL_PERMISSION_ROWS.filter(
      (row) => row.category === 'shell' || row.category === 'http-write',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const mode of ['ask', 'accept-edits', 'strict'] as const) {
        expect(row.decisions[mode], `${label(row)} in ${mode}`).toBe('ask');
      }
    }
  });

  it('http-write is the R3 network-write class', () => {
    expect(HTTP_WRITE_CLASSIFICATION).toMatchObject({ effect: 'network-write', risk: 'R3' });
  });

  it('modes only tighten: strict >= ask >= accept-edits >= autonomous-scoped', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      const at = (mode: AgentPermissionMode): number => SEVERITY[row.decisions[mode]];
      expect(at('strict') >= at('ask'), label(row)).toBe(true);
      expect(at('ask') >= at('accept-edits'), label(row)).toBe(true);
      expect(at('accept-edits') >= at('autonomous-scoped'), label(row)).toBe(true);
    }
  });

  it('a call the table does not know is asked about, never run', () => {
    for (const category of ['browser', 'agents', 'shell', 'http-write', 'command'] as const) {
      for (const mode of ['ask', 'accept-edits', 'autonomous-scoped', 'strict'] as const) {
        const unknown = { toolName: 'a.new', operation: 'frob', arguments: {}, category };
        expect(decisionFor(mode, unknown), `${category} in ${mode}`).toBe('ask');
      }
    }
  });
});

describe('a child can never exceed its parent', () => {
  it('is never granted a category its parent does not hold, whatever it asks for', () => {
    for (let mask = 1; mask < 2 ** ALL_CATEGORIES.length; mask += 37) {
      const parent = ALL_CATEGORIES.filter((_, index) => (mask >> index) % 2 === 1);
      const result = narrowGrant(
        { allow: parent, writeScope: undefined, writeDeny: undefined },
        { ...SPAWN, tools: [...ALL_CATEGORIES] },
      );
      if (typeof result === 'string') continue;
      expect(result.granted.every((category) => parent.includes(category))).toBe(true);
      const unasked = narrowGrant(
        { allow: parent, writeScope: undefined, writeDeny: undefined },
        SPAWN,
      );
      if (typeof unasked !== 'string') expect(unasked.granted).not.toContain('agents');
    }
  });

  it('is asked about on the same table as its parent: the mode is inherited, not chosen', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      for (const mode of AGENT_PERMISSION_MODES) {
        expect(decisionFor(mode, requestOf(row)), label(row)).toBe(row.decisions[mode]);
      }
    }
  });
});

describe('the headless --permission-mode values', () => {
  it.each(AGENT_PERMISSION_MODES)('%s is accepted and carried to the run', (mode) => {
    const parsed = parseHeadlessArgs(['-p', 'task', '--permission-mode', mode], {}, process.cwd());
    expect(parsed.kind).toBe('run');
    if (parsed.kind === 'run') expect(parsed.invocation.permissionMode).toBe(mode);
  });

  it.each(['bypass', 'ASK', 'yolo', 'auto'])('%s is refused', (value) => {
    const parsed = parseHeadlessArgs(['-p', 'task', '--permission-mode', value], {}, process.cwd());
    expect(parsed.kind).toBe('usage');
  });

  it('a mode never widens a run to the newer categories', () => {
    for (const mode of AGENT_PERMISSION_MODES) {
      const parsed = parseHeadlessArgs(
        ['-p', 'task', '--permission-mode', mode],
        {},
        process.cwd(),
      );
      if (parsed.kind !== 'run') throw new Error(mode);
      for (const category of ['http', 'http-write', 'browser', 'shell', 'agents'] as const) {
        expect(parsed.invocation.allowTools, `${mode} -> ${category}`).not.toContain(category);
      }
    }
  });
});
