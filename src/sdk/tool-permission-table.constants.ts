import type {
  EditorModeNames,
  ToolDecisions,
  ToolPermissionRow,
} from './tool-permission-table.types';
import type { AgentToolCategory } from './workspace-toolkit.types';
import type { OperationClassification } from '../core/runtime/runtime-operation-classification';

/** The SDK's permission modes and the editor's Approval dropdown values they correspond to. */
export const EDITOR_MODE_NAMES: EditorModeNames = {
  plan: 'PLAN',
  ask: 'ASK',
  'accept-edits': 'AUTO_EDIT',
  'autonomous-scoped': 'AUTONOMOUS_SCOPED',
  strict: 'ENTERPRISE_LOCKED',
};

/** A POST, PUT, PATCH or DELETE: it changes data on another machine and cannot be undone from here. */
export const HTTP_WRITE_CLASSIFICATION: OperationClassification = {
  effect: 'network-write',
  risk: 'R3',
  reversible: false,
};

// What a mode does with a call, by kind of call. The rows below name one.
//
// The rule behind every profile: anything that reaches the network or the shell
// and changes something is asked about in every mode but `plan`, where it is not
// offered. `autonomous-scoped` runs what stays on the machine (edits, commands)
// and what only reads from an operator-chosen host (GET, a page load); it never
// runs a network write, a form submission or a shell script unasked.

/** Observation: nothing starts and nothing changes. Never asked. */
const FREE: ToolDecisions = {
  plan: 'allow',
  ask: 'allow',
  'accept-edits': 'allow',
  'autonomous-scoped': 'allow',
  strict: 'allow',
};

/** Observation of a category plan mode withholds whole (command, browser, agents). */
const FREE_BUT_WITHHELD_IN_PLAN: ToolDecisions = { ...FREE, plan: 'deny' };

/** Starts a local process or a page load: like `workspace.command.run`, asked unless the mode runs local work. */
const RUNS_LOCAL: ToolDecisions = {
  plan: 'deny',
  ask: 'ask',
  'accept-edits': 'ask',
  'autonomous-scoped': 'allow',
  strict: 'ask',
};

/** Changes something outside this process, or cannot be classified: asked in every mode, absent in plan. */
const ALWAYS_ASKED: ToolDecisions = {
  plan: 'deny',
  ask: 'ask',
  'accept-edits': 'ask',
  'autonomous-scoped': 'ask',
  strict: 'ask',
};

/** A read that sends the run's data to a model: free everywhere except `strict`, where the organization has locked egress. */
const READ_THEN_SEND: ToolDecisions = { ...FREE, strict: 'ask' };

type Differences = ToolPermissionRow['editorDiffers'];

const READ_R0_DIFFERS: Differences = { ask: 'READ_NEVER_ASKED', strict: 'READ_NEVER_ASKED' };
const READ_R0_WITHHELD_DIFFERS: Differences = {
  plan: 'PLAN_WITHHOLDS_CATEGORY',
  ...READ_R0_DIFFERS,
};
const FETCH_R2_DIFFERS: Differences = {
  ask: 'READ_NEVER_ASKED',
  'accept-edits': 'READ_NEVER_ASKED',
  strict: 'READ_NEVER_ASKED',
};
const FETCH_R2_ASKED_DIFFERS: Differences = { plan: 'PLAN_WITHHOLDS_CATEGORY' };
const NONE: Differences = {};

function rows(
  tool: string,
  category: AgentToolCategory,
  operations: readonly string[],
  decisions: ToolDecisions,
  editorDiffers: Differences,
): readonly ToolPermissionRow[] {
  return operations.map((operation) => ({ tool, operation, category, decisions, editorDiffers }));
}

/**
 * Every tool operation of the headless agent's newer tools and what each of the
 * five modes does with it. The SDK enforces this table (`needsApproval`,
 * `permissionsForMode`), `tests/unit/tool-permission-editor-agreement.test.ts`
 * checks it against the editor's own policy, and `docs/PERMISSION_MATRIX.md` is
 * generated from it. A tool operation with no row fails
 * `tests/unit/tool-permission-drift.test.ts`.
 *
 * Decisions that were chosen, not derived:
 * - `agent.team spawn` is asked in `ask`, `accept-edits` and `strict`: a child
 *   spends budget and runs commands, which is not an edit. A child holds the
 *   parent's mode and its own approver, so it can never hold more than the parent.
 * - `vision.describe` is free until `strict`: the path is workspace-contained,
 *   calls are capped per run and the model is the one the run already talks
 *   to, but pixels (a screenshot of a secret) cannot be redacted.
 * - `browser.page click|type|press` is R3 network-write: it can submit a form
 *   to a remote site. `open` is a read from an operator-listed host, like an
 *   `http.request` GET, so `autonomous-scoped` runs it.
 */
export const TOOL_PERMISSION_ROWS: readonly ToolPermissionRow[] = [
  ...rows('task.plan', 'read', ['set', 'update', 'list', 'next'], FREE, READ_R0_DIFFERS),
  ...rows('knowledge.context', 'read', ['index', 'read', 'search', 'task'], FREE, READ_R0_DIFFERS),
  ...rows('vision.describe', 'read', ['describe'], READ_THEN_SEND, {
    ask: 'READ_NEVER_ASKED',
    'accept-edits': 'READ_NEVER_ASKED',
  }),
  ...rows('workspace.command', 'command', ['run'], RUNS_LOCAL, NONE),
  ...rows('process.watch', 'command', ['start'], RUNS_LOCAL, NONE),
  ...rows(
    'process.watch',
    'command',
    ['status', 'output', 'wait', 'list', 'stop'],
    FREE_BUT_WITHHELD_IN_PLAN,
    READ_R0_WITHHELD_DIFFERS,
  ),
  ...rows('code.gates', 'command', ['run'], RUNS_LOCAL, NONE),
  ...rows(
    'code.gates',
    'command',
    ['detect', 'report'],
    FREE_BUT_WITHHELD_IN_PLAN,
    READ_R0_WITHHELD_DIFFERS,
  ),
  ...rows('http.request', 'http', ['request'], FREE, FETCH_R2_DIFFERS),
  {
    tool: 'http.request',
    operation: 'request',
    category: 'http-write',
    classification: HTTP_WRITE_CLASSIFICATION,
    decisions: ALWAYS_ASKED,
    editorDiffers: NONE,
  },
  ...rows('browser.page', 'browser', ['open'], RUNS_LOCAL, FETCH_R2_ASKED_DIFFERS),
  ...rows('browser.page', 'browser', ['click', 'type', 'press'], ALWAYS_ASKED, NONE),
  ...rows(
    'browser.page',
    'browser',
    ['snapshot', 'wait', 'screenshot', 'resize', 'console', 'network', 'close'],
    FREE_BUT_WITHHELD_IN_PLAN,
    READ_R0_WITHHELD_DIFFERS,
  ),
  ...rows('workspace.shell', 'shell', ['run'], ALWAYS_ASKED, NONE),
  ...rows('agent.team', 'agents', ['spawn'], RUNS_LOCAL, NONE),
  ...rows(
    'agent.team',
    'agents',
    ['message', 'inbox', 'wait', 'status', 'result', 'cancel'],
    FREE_BUT_WITHHELD_IN_PLAN,
    READ_R0_WITHHELD_DIFFERS,
  ),
];

/**
 * Tools older than the table, covered by `tests/unit/sdk-permission-policy-modes.test.ts`
 * and `tests/unit/sdk-git-tools-permissions.test.ts` rather than by a row.
 */
export const TOOLS_COVERED_ELSEWHERE: readonly string[] = [
  'workspace.file',
  'workspace.git',
  'workspace.notes',
];
