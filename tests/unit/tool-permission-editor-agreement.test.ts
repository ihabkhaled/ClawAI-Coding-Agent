import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluatePolicyV2 } from '../../src/core/policy-v2';
import { classifiedOperation } from '../../src/core/runtime/runtime-operation-classification';
import { AGENT_PERMISSION_MODES } from '../../src/sdk/permission-modes.constants';
import {
  EDITOR_MODE_NAMES,
  TOOL_PERMISSION_ROWS,
} from '../../src/sdk/tool-permission-table.constants';
import { decide } from '../helpers/permission-matrix';

import type { OperationClassification } from '../../src/core/runtime/runtime-operation-classification';
import type { ToolDecision, ToolPermissionRow } from '../../src/sdk/tool-permission-table.types';

const SCOPE = {
  accountId: 'agreement',
  backendOrigin: 'https://claw.local',
  workspaceId: 'agreement',
  targetId: 'target:workspace',
  root: '/',
} as const;

const label = (row: ToolPermissionRow): string => `${row.tool}.${row.operation} [${row.category}]`;

function classificationOf(row: ToolPermissionRow): OperationClassification {
  const found = row.classification ?? classifiedOperation(row.tool, row.operation);
  if (found === undefined) throw new Error(`${label(row)} has no classification in the editor`);
  return found;
}

/** What the editor's policy engine says about a call in the editor's name for the mode. */
function editorDecision(
  row: ToolPermissionRow,
  mode: keyof typeof EDITOR_MODE_NAMES,
): ToolDecision {
  return evaluatePolicyV2({
    runId: 'agreement',
    invocationHash: `sha256:${'0'.repeat(64)}`,
    mode: EDITOR_MODE_NAMES[mode],
    ...classificationOf(row),
    scope: SCOPE,
    workspaceTrusted: true,
    userPresent: true,
  }).outcome;
}

describe('the SDK table and the editor policy agree', () => {
  it('every row has an editor classification', () => {
    const missing = TOOL_PERMISSION_ROWS.filter(
      (row) => (row.classification ?? classifiedOperation(row.tool, row.operation)) === undefined,
    ).map(label);
    expect(missing).toEqual([]);
  });

  it('differs from the editor in exactly the modes and for exactly the reasons the row names', () => {
    const wrong: string[] = [];
    for (const row of TOOL_PERMISSION_ROWS) {
      for (const mode of AGENT_PERMISSION_MODES) {
        const editor = editorDecision(row, mode);
        const differs = editor !== row.decisions[mode];
        const declared = row.editorDiffers[mode];
        if (differs !== (declared !== undefined)) {
          wrong.push(
            `${label(row)} ${mode}: sdk ${row.decisions[mode]}, editor ${editor}, declared ${declared ?? 'none'}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is looser than the editor only on a read, and only because the SDK never asks about reads', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      for (const mode of AGENT_PERMISSION_MODES) {
        const editor = editorDecision(row, mode);
        const sdk = row.decisions[mode];
        if (sdk === editor) continue;
        const sdkIsLooser = sdk === 'allow' && editor !== 'allow';
        if (sdkIsLooser) {
          expect(row.editorDiffers[mode], `${label(row)} ${mode}`).toBe('READ_NEVER_ASKED');
          expect(classificationOf(row).effect, `${label(row)} ${mode}`).toBe('read');
          expect(editor, `${label(row)} ${mode}`).toBe('ask');
        } else {
          expect(row.editorDiffers[mode], `${label(row)} ${mode}`).not.toBe('READ_NEVER_ASKED');
        }
      }
    }
  });

  it('is stricter than the editor only in plan, where it withholds a whole category', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      for (const mode of AGENT_PERMISSION_MODES) {
        if (row.editorDiffers[mode] !== 'PLAN_WITHHOLDS_CATEGORY') continue;
        expect(mode).toBe('plan');
        expect(row.decisions.plan).toBe('deny');
        expect(editorDecision(row, 'plan')).toBe('allow');
        expect(classificationOf(row).effect).toBe('read');
      }
    }
  });

  it('never lets the SDK run an operation the editor refuses or asks about when it changes something', () => {
    for (const row of TOOL_PERMISSION_ROWS) {
      if (classificationOf(row).effect === 'read') continue;
      for (const mode of AGENT_PERMISSION_MODES) {
        expect(row.decisions[mode], `${label(row)} ${mode}`).toBe(editorDecision(row, mode));
      }
    }
  });

  it('the real runtime adapter gives the same answer as the policy engine', async () => {
    for (const row of TOOL_PERMISSION_ROWS.filter((item) => item.classification === undefined)) {
      for (const mode of AGENT_PERMISSION_MODES) {
        const verdict = (await decide(row.tool, row.operation, { mode: EDITOR_MODE_NAMES[mode] }))
          .verdict;
        expect(verdict, `${label(row)} ${mode}`).toBe(editorDecision(row, mode));
      }
    }
  });
});

describe('the Approval dropdown', () => {
  it('offers exactly the five modes the SDK maps to', () => {
    const markup = readFileSync(join(process.cwd(), 'src/webview/chat-composer-markup.ts'), 'utf8');
    const select = /<select id="permissionMode"[\s\S]*?<\/select>/u.exec(markup)?.[0] ?? '';
    const options = [...select.matchAll(/<option value="([A-Z_]+)"/gu)].map((match) => match[1]);
    expect(options.sort()).toEqual(Object.values(EDITOR_MODE_NAMES).sort());
  });
});
