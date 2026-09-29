const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { stdout } = require('node:process');
const vscode = require('vscode');

const ROOT_KEY = 'workspace-1';
const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };
let sequence = 0;

const report = (line) => stdout.write(`${line}\n`);

function invocation(toolName, operation, args, targetId) {
  sequence += 1;
  const id = `tools_${String(Date.now())}_${String(sequence).padStart(4, '0')}`;
  return {
    schemaVersion: '2.0',
    invocationId: `inv_${id}`,
    runId: 'run_runtime_tools',
    turnId: 'turn_runtime_tools',
    toolName,
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: targetId ?? 'target:workspace',
    epochs,
    idempotencyKey: `idem_${id}`,
    requestedAt: new Date().toISOString(),
  };
}

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the host opened a workspace folder');
  return folder.uri.fsPath;
}

/**
 * Every runtime tool the inventory could not vouch for, called for real.
 *
 * Each had a unit test and an inventory row saying NOT RUN, which is an honest
 * pair: a unit test proves the code does what it was written to do, and says
 * nothing about whether the tool is reachable, registered, or given a target
 * it recognises. Three features in a row turned out to be wired everywhere
 * except the layer that mattered, so reachability is the thing worth proving.
 *
 * An empty answer is the expected answer here. A fresh workspace has no
 * services, no findings, no journals and no goals — so what these assert is
 * that the tool answers *in its own shape* rather than refusing, throwing, or
 * failing to be registered at all.
 */
async function runRuntimeTools(api) {
  const workspace = workspaceRoot();
  const call = (toolName, operation, args, targetId) =>
    api.executeTool(
      invocation(toolName, operation, args, targetId),
      globalThis.AbortSignal.timeout(30_000),
    );

  // Reads of an empty workspace. Each names the collection it owns, which is
  // how an answer is told apart from a tool that returns something generic.
  for (const [toolName, operation, args, key] of [
    ['workspace.planning', 'list-tasks', {}, 'tasks'],
    ['runtime.journal', 'search', { query: 'nothing-here' }, 'journals'],
    ['runtime.workflows', 'list', {}, 'workflows'],
    ['workspace.services', 'list', {}, 'services'],
    ['workspace.services', 'discover', { rootKey: ROOT_KEY }, 'services'],
    ['workspace.quality', 'discover', { rootKey: ROOT_KEY }, 'projects'],
    ['workspace.quality', 'list-findings', {}, 'findings'],
    ['workspace.intelligence', 'diagnostics', { rootKey: ROOT_KEY }, 'diagnostics'],
  ]) {
    const output = await call(toolName, operation, args);
    assert.ok(
      Array.isArray(output.structured?.[key]),
      `${toolName}.${operation} answered without a ${key} list: ${JSON.stringify(output).slice(0, 120)}`,
    );
    report(`TOOL ${toolName}.${operation}: ${key}=${String(output.structured[key].length)}`);
  }

  // A goal that has not been declared says so, rather than inventing one.
  const goal = await call('runtime.goal', 'status', {});
  assert.equal(goal.structured?.declared, false, 'an undeclared goal reported itself as declared');
  report('TOOL runtime.goal.status: declared=false');

  // A scan of a file that is not there is refused with a reason, not a throw.
  // The reason is what lets an agent correct itself instead of retrying.
  const scan = await call('workspace.scan', 'import', { rootKey: ROOT_KEY, path: 'absent.sarif' });
  assert.equal(scan.structured?.imported, false, 'a missing SARIF file reported itself imported');
  assert.ok(String(scan.structured?.reason).length > 0, 'a refused import gave no reason');
  report(`TOOL workspace.scan.import: refused with reason=${String(scan.structured.reason)}`);

  // A notebook the agent just wrote, read back through the notebook tool.
  writeFileSync(
    path.join(workspace, 'probe.ipynb'),
    JSON.stringify({
      cells: [{ cell_type: 'code', source: ['print("hi")'], metadata: {}, outputs: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }),
    'utf8',
  );
  const notebook = await call('workspace.notebook', 'read', {
    rootKey: ROOT_KEY,
    path: 'probe.ipynb',
  });
  assert.match(
    JSON.stringify(notebook),
    /print/u,
    'the notebook tool did not return the cell that was written',
  );
  report('TOOL workspace.notebook.read: returned the written cell');

  // Every one of these refuses a call that names no target it recognises.
  // Enforcing the target is what keeps a database tool off the workspace.
  await assert.rejects(
    () => call('workspace.database', 'profiles', {}, 'target:workspace'),
    /target is not registered/iu,
    'the database tool accepted a workspace target',
  );
  report('TOOL workspace.database.profiles: refuses a target it does not own');
}

module.exports = { runRuntimeTools };
