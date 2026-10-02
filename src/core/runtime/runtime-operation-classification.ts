import { classifyMcpOperation } from '../mcp/mcp-policy-classification';

import type { PolicyRequest } from '../policy-v2';

export type OperationClassification = Pick<PolicyRequest, 'effect' | 'risk' | 'reversible'>;

const READ: OperationClassification = { effect: 'read', risk: 'R0', reversible: true };
const FETCH: OperationClassification = { effect: 'read', risk: 'R2', reversible: true };
const WRITE: OperationClassification = { effect: 'workspace-write', risk: 'R1', reversible: true };
const RUN: OperationClassification = { effect: 'local-mutation', risk: 'R2', reversible: false };
const MUTATE: OperationClassification = { effect: 'local-mutation', risk: 'R3', reversible: false };
const NETWORK: OperationClassification = { effect: 'network-write', risk: 'R3', reversible: false };
const PUBLISH: OperationClassification = { effect: 'publication', risk: 'R3', reversible: false };
const DESTROY: OperationClassification = { effect: 'destructive', risk: 'R4', reversible: false };
const ELEVATE: OperationClassification = { effect: 'elevation', risk: 'R4', reversible: false };

/**
 * What an operation nobody classified is treated as: an irreversible local
 * mutation that always asks. A new operation is refused the quiet path until
 * someone decides what it is, and `permission-matrix.test.ts` fails until
 * they do. The old fallback was read/R0, which is the loosest class there is.
 */
export const UNCLASSIFIED_OPERATION: OperationClassification = MUTATE;

type ToolTable = Readonly<Record<string, OperationClassification>>;

function group(classification: OperationClassification, operations: readonly string[]): ToolTable {
  return Object.fromEntries(operations.map((operation) => [operation, classification]));
}

function merge(...tables: readonly ToolTable[]): ToolTable {
  return tables.reduce<ToolTable>((all, table) => ({ ...all, ...table }), {});
}

// `runtime.*` tools were classed R2 local-mutation by accident (the word
// "runtime" matched a `run` pattern). That is stricter than most of them need
// and it is kept: this table records the behaviour, it does not loosen it.
const runtimeInternal = (operations: readonly string[]): ToolTable => group(RUN, operations);

const BROWSER_INTERACTION = [
  'click',
  'click-at',
  'download',
  'drag',
  'fill',
  'keyboard',
  'select',
  'type-text',
  'upload',
] as const;

const BROWSER_OBSERVATION = [
  'accessibility',
  'close',
  'close-context',
  'close-tab',
  'console',
  'hover',
  'launch',
  'locate',
  'measure-layout',
  'network',
  'new-context',
  'new-tab',
  'observe',
  'pdf',
  'return-control',
  'screenshot',
  'scroll',
  'snapshot',
  'storage',
  'takeover',
  'trace-start',
  'trace-stop',
  'video',
  'wait-ready',
] as const;

const CONTAINER_OPERATIONS = [
  'build',
  'compose-build',
  'compose-down',
  'compose-exec',
  'compose-run',
  'compose-up',
  'containers',
  'contexts',
  'engine-info',
  'exec',
  'health',
  'images',
  'inspect',
  'logs',
  'networks',
  'pull',
  'restart',
  'run',
  'start',
  'stats',
  'stop',
  'volumes',
] as const;

const GIT_READS = [
  'blame',
  'branches',
  'conflicts',
  'diff',
  'log',
  'pr-readiness',
  'remotes',
  'status',
  'submodules',
  'tags',
  'topology',
  'worktrees',
] as const;

const GIT_MUTATIONS = [
  'cherry-pick',
  'commit',
  'create-branch',
  'create-worktree',
  'merge',
  'pull',
  'rebase',
  'remove-worktree',
  'revert',
  'stage',
  'stash',
  'unstage',
] as const;

const PROCESS_OPERATIONS = [
  'create',
  'dispose',
  'inspect',
  'interrupt',
  'join',
  'pause',
  'race',
  'resize',
  'resume',
  'terminate',
  'write',
] as const;

const runtimeTools: Readonly<Record<string, ToolTable>> = {
  'runtime.advisor': runtimeInternal(['consult']),
  'runtime.agents': runtimeInternal(['run']),
  'runtime.ask': runtimeInternal(['ask']),
  'runtime.board': runtimeInternal(['post', 'read']),
  'runtime.elevation': group(ELEVATE, ['execute']),
  'runtime.end': runtimeInternal(['end']),
  'runtime.evidence': merge(
    runtimeInternal(['build', 'render-markdown', 'verify']),
    group(WRITE, ['export-markdown', 'export-zip']),
  ),
  'runtime.flagship': group(MUTATE, ['run']),
  'runtime.goal': runtimeInternal(['declare', 'resolve', 'status']),
  'runtime.integration': group(MUTATE, ['integrate']),
  'runtime.journal': merge(
    group(DESTROY, ['delete']),
    group(WRITE, ['safe-export', 'save']),
    group(FETCH, ['search']),
    runtimeInternal(['load']),
  ),
  'runtime.mcp': {
    servers: classifyMcpOperation('servers'),
    tools: classifyMcpOperation('tools'),
    call: classifyMcpOperation('call'),
  },
  'runtime.messages': runtimeInternal(['peers', 'receive', 'send']),
  'runtime.monitor': runtimeInternal(['wait']),
  'runtime.notify': runtimeInternal(['notify']),
  // Loads a tool's input schema into the next turn; it runs and changes nothing.
  'runtime.tool_search': group(FETCH, ['search']),
  'runtime.remote': merge(
    group(NETWORK, ['create', 'trigger']),
    runtimeInternal(['list', 'status']),
  ),
  'runtime.review': runtimeInternal(['run']),
  'runtime.schedule': merge(
    group(MUTATE, ['create']),
    group(DESTROY, ['delete']),
    runtimeInternal(['list']),
  ),
  'runtime.workflows': merge(
    group(WRITE, ['save']),
    runtimeInternal(['list', 'load', 'save-template']),
  ),
  'runtime.worktree': merge(group(MUTATE, ['enter', 'exit']), runtimeInternal(['status'])),
};

const workspaceTools: Readonly<Record<string, ToolTable>> = {
  // The headless agent's own tools. The SDK permission table
  // (src/sdk/tool-permission-table.constants.ts) is checked against these rows,
  // so the editor and the SDK cannot disagree about what a call is.
  'agent.team': merge(
    group(RUN, ['spawn']),
    group(READ, ['message', 'inbox', 'wait', 'status', 'result', 'cancel']),
  ),
  // Loading a page reaches the network. Acting on one can submit a form to a
  // remote site (R3), whatever the operator's host list says about WHERE it may go.
  'browser.page': merge(
    group(FETCH, ['open']),
    group(NETWORK, ['click', 'type', 'press']),
    group(READ, ['snapshot', 'wait', 'screenshot', 'resize', 'console', 'network', 'close']),
  ),
  'knowledge.context': group(READ, ['index', 'read', 'search', 'task']),
  'task.plan': group(READ, ['set', 'update', 'list', 'next']),
  // Reads a workspace image and sends the bytes to a model: cost, and the pixels leave the machine.
  'vision.describe': group(FETCH, ['describe']),
  'workspace.artifact': merge(group(READ, ['prepare']), group(PUBLISH, ['publish'])),
  // Anything that acts on a page can change state on a remote site. `click-at`
  // and `type-text` were missing from the old pattern and fell through to
  // read/R0. Navigation reaches an arbitrary URL, so it is a network read.
  'workspace.browser': merge(
    group(NETWORK, BROWSER_INTERACTION),
    group(FETCH, ['navigate']),
    group(READ, BROWSER_OBSERVATION),
  ),
  'workspace.command': group(RUN, ['run']),
  // A read asks a server for something; a send changes data there, and is a network write.
  // `request` is the SDK tool's single operation (GET and HEAD; the SDK table makes a
  // POST, PUT, PATCH or DELETE the `http-write` category), `get`/`send` are the editor's.
  'http.request': merge(group(FETCH, ['request', 'get']), group(NETWORK, ['send'])),
  // A script can do anything the user can: an irreversible local mutation that every mode asks about.
  'workspace.shell': group(MUTATE, ['run']),
  // Only starting a process changes anything; the rest watch or stop one the run started.
  'process.watch': merge(
    group(RUN, ['start']),
    group(READ, ['status', 'output', 'wait', 'list', 'stop']),
  ),
  // Only `run` executes a project command; `detect` and `report` read files and earlier results.
  'code.gates': merge(group(RUN, ['run']), group(READ, ['detect', 'report'])),
  // `remove` matched the `move` write pattern and was R1 workspace-write.
  'workspace.container': merge(group(DESTROY, ['remove']), group(RUN, CONTAINER_OPERATIONS)),
  // Applying a migration changes a database the agent does not own.
  'workspace.database': merge(
    group(MUTATE, ['migration-apply']),
    group(RUN, ['discover', 'explain', 'introspect', 'migration-dry-run', 'profiles', 'query']),
  ),
  'workspace.dependency-audit': group(RUN, ['run']),
  'workspace.files': merge(
    group(DESTROY, ['delete']),
    group(WRITE, ['artifact', 'copy', 'create', 'mkdir', 'patch', 'rename', 'update']),
    group(READ, ['binary-metadata', 'glob', 'list', 'read', 'search', 'stat']),
  ),
  'workspace.git': merge(
    group(PUBLISH, ['push', 'tag']),
    group(FETCH, ['fetch']),
    group(READ, GIT_READS),
    group(MUTATE, GIT_MUTATIONS),
  ),
  'workspace.intelligence': group(READ, [
    'definition',
    'diagnostics',
    'estimate-context',
    'hover',
    'implementations',
    'invalidate',
    'query',
    'references',
    'refresh',
  ]),
  // Inserting or replacing a cell rewrites the notebook file; neither name
  // contains a write verb, so both were read/R0.
  'workspace.notebook': merge(
    group(WRITE, ['insert-cell', 'replace-cell']),
    group(DESTROY, ['delete-cell']),
    group(RUN, ['run-all', 'run-cell']),
    group(READ, ['read']),
  ),
  // Planning tools shape the agent's own plan; plan mode has to be able to use them.
  'workspace.planning': merge(
    group(WRITE, ['export']),
    group(READ, [
      'adopt',
      'issue-payloads',
      'list-tasks',
      'render-json',
      'render-markdown',
      'set-tasks',
      'validate',
    ]),
  ),
  // `create` and `write` matched write verbs and were R1: an auto-edit session
  // could start a process and feed it input unasked, while `command.run` asked.
  'workspace.process': group(RUN, PROCESS_OPERATIONS),
  'workspace.pull-request': merge(
    group(READ, ['draft']),
    group(FETCH, ['fetch-checks', 'fetch-failure-logs']),
    group(PUBLISH, ['publish']),
  ),
  'workspace.quality': merge(
    group(RUN, ['run']),
    group(READ, ['discover', 'list-findings', 'plan', 'report']),
  ),
  'workspace.scan': group(READ, ['import']),
  // Start, stop and restart launch or kill processes; they were read/R0.
  'workspace.services': merge(
    group(RUN, ['register', 'restart', 'restore', 'start', 'start-all', 'stop']),
    group(READ, ['discover', 'list']),
  ),
  'workspace.web': group(FETCH, ['crawl', 'extract', 'fetch', 'search']),
};

const CLASSIFICATION: Readonly<Record<string, ToolTable>> = {
  'fixture.workspace-summary': group(READ, ['read']),
  ...runtimeTools,
  ...workspaceTools,
};

/** The classification recorded for a tool operation, or undefined when nobody wrote one. */
export function classifiedOperation(
  tool: string,
  operation: string,
): OperationClassification | undefined {
  return CLASSIFICATION[tool]?.[operation];
}
