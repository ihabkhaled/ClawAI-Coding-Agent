const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { stdout } = require('node:process');
const vscode = require('vscode');

const ROOT_KEY = 'workspace-1';
const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };
let sequence = 0;

/** One evidence line per real operation, so a CI log shows what ran. */
function report(line) {
  stdout.write(`${line}\n`);
}

/**
 * A real invocation, shaped exactly as the runtime sends one.
 *
 * Ids are unique per call because executors key idempotency on them: two calls
 * sharing an id can be answered from the first one's receipt, which would make
 * the second assertion prove nothing.
 */
function invocation(toolName, operation, args) {
  sequence += 1;
  const id = `host_${String(Date.now())}_${String(sequence).padStart(4, '0')}`;
  return {
    schemaVersion: '2.0',
    invocationId: `inv_${id}`,
    runId: 'run_host_real_tools',
    turnId: 'turn_host_real_tools',
    toolName,
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: `idem_${id}`,
    requestedAt: new Date().toISOString(),
  };
}

function transaction(operation) {
  sequence += 1;
  return {
    transaction: {
      transactionId: `txn_host_${String(sequence).padStart(6, '0')}`,
      summary: 'host lane real-tool check',
      operations: [operation],
    },
  };
}

function command(args) {
  return invocation('workspace.command', 'run', {
    executable: 'node',
    arguments: args,
    cwdRootKey: ROOT_KEY,
    cwd: '.',
    timeoutMs: 60_000,
    outputLimitBytes: 4_096,
    expectedEffect: 'read',
    targetId: 'target:workspace',
  });
}

function git(operation, extra = {}) {
  return invocation('workspace.git', operation, { rootKey: ROOT_KEY, operation, ...extra });
}

function hashOf(output) {
  return /sha256:[a-f0-9]{64}/u.exec(JSON.stringify(output))?.[0];
}

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the host opened a workspace folder');
  return folder.uri.fsPath;
}

/**
 * The tools that do the coding, run for real.
 *
 * Every assertion checks the effect independently — through node:fs or the
 * git binary, never through the tool's own report. A tool that says it wrote a
 * file and a file that exists are different claims, and only the second is the
 * one a user cares about.
 */
async function runRealTools(api) {
  const workspace = workspaceRoot();
  const target = path.join(workspace, 'src', 'greeting.ts');

  // create: a new file lands on disk with exactly the content asked for.
  await api.executeTool(
    invocation(
      'workspace.files',
      'create',
      transaction({
        kind: 'create',
        rootKey: ROOT_KEY,
        path: 'src/greeting.ts',
        contentLines: ['export const greeting = "hello";', ''],
        beforeHash: null,
      }),
    ),
  );
  assert.ok(existsSync(target), 'create put the file on disk');
  assert.equal(
    readFileSync(target, 'utf8').replace(/\r\n/gu, '\n'),
    'export const greeting = "hello";\n',
    'create wrote exactly the requested content',
  );
  report('REAL create: file on disk with exact content');

  // read: the tool returns what is actually on disk, and its hash.
  const read = await api.executeTool(
    invocation('workspace.files', 'read', { rootKey: ROOT_KEY, path: 'src/greeting.ts' }),
  );
  assert.match(JSON.stringify(read), /greeting = \\"hello\\"/u, 'read returned the content');
  const hash = hashOf(read);
  assert.ok(hash, 'read reported the content hash an edit needs');
  report('REAL read: content and hash returned');

  // update: the whole file is replaced, guarded by the hash just read.
  await api.executeTool(
    invocation(
      'workspace.files',
      'update',
      transaction({
        kind: 'update',
        rootKey: ROOT_KEY,
        path: 'src/greeting.ts',
        contentLines: ['export const greeting = "hello, world";', ''],
        beforeHash: hash,
      }),
    ),
  );
  assert.match(readFileSync(target, 'utf8'), /hello, world/u, 'update changed the file on disk');
  report('REAL update: disk changed');

  // A stale hash is refused and the file is left alone. This is the guard that
  // stops an agent overwriting a change it never saw.
  await assert.rejects(
    api.executeTool(
      invocation(
        'workspace.files',
        'update',
        transaction({
          kind: 'update',
          rootKey: ROOT_KEY,
          path: 'src/greeting.ts',
          contentLines: ['clobbered', ''],
          beforeHash: hash,
        }),
      ),
    ),
  );
  assert.match(readFileSync(target, 'utf8'), /hello, world/u, 'a refused update changed nothing');
  report('REAL stale-hash update: refused, disk untouched');

  // patch: an exact in-place replacement, the edit models make most. It runs
  // through the same editor-buffer path as update, which is the path that
  // used to leave the disk unchanged.
  const beforePatch = await api.executeTool(
    invocation('workspace.files', 'read', { rootKey: ROOT_KEY, path: 'src/greeting.ts' }),
  );
  await api.executeTool(
    invocation(
      'workspace.files',
      'patch',
      transaction({
        kind: 'patch',
        rootKey: ROOT_KEY,
        path: 'src/greeting.ts',
        beforeHash: hashOf(beforePatch),
        hunks: [
          {
            beforeLines: ['export const greeting = "hello, world";'],
            afterLines: ['export const greeting = "hello, patched";'],
          },
        ],
      }),
    ),
  );
  assert.match(readFileSync(target, 'utf8'), /hello, patched/u, 'patch changed the file on disk');
  report('REAL patch: disk changed');

  // search: finds text that exists only because the agent wrote it.
  const search = await api.executeTool(
    invocation('workspace.files', 'search', { rootKey: ROOT_KEY, query: 'hello, patched' }),
  );
  assert.match(JSON.stringify(search), /greeting\.ts/u, 'search found the agent-written file');
  report('REAL search: found the agent-written file');

  // command: a real process runs in the workspace and its result comes back.
  const ran = await api.executeTool(command(['-e', 'process.stdout.write(String(6 * 7))']));
  assert.match(JSON.stringify(ran), /42/u, 'the command ran and its output came back');
  report('REAL command: output returned');

  // command: a failing process reports its failure rather than success.
  const failed = await api.executeTool(command(['-e', 'process.exit(3)'])).then(
    (output) => JSON.stringify(output),
    (error) => String(error),
  );
  report(`REAL failing command: ${failed.slice(0, 160)}`);
  assert.match(failed, /\b3\b/u, 'a failing command reports its exit status');

  // git: status sees the agent's file, and a commit really lands.
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'host@claw.test'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'Host Lane'], { cwd: workspace });
  const status = await api.executeTool(git('status'));
  assert.match(JSON.stringify(status), /greeting\.ts/u, 'git status sees the agent-written file');
  report('REAL git status: sees the file');

  // git: a commit waits for a person to approve the staged diff, and does not
  // land without one. The host has nobody to click Approve, so the call is
  // abandoned after a few seconds and the repository must still be empty.
  // Passing this is the gate holding, not the commit failing.
  await api.executeTool(git('stage', { paths: ['src/greeting.ts'] }));
  const unapproved = await api
    .executeTool(
      git('commit', { message: 'feat: add greeting' }),
      globalThis.AbortSignal.timeout(4_000),
    )
    .then(
      () => 'committed',
      (error) => String(error),
    );
  report(`REAL git commit without approval: ${unapproved.slice(0, 120)}`);
  assert.notEqual(unapproved, 'committed', 'a commit did not land without approval');
  const heads = execFileSync('git', ['rev-list', '--all', '--count'], { cwd: workspace })
    .toString()
    .trim();
  assert.equal(heads, '0', 'no commit exists in the repository');

  // git: the staged-secret scan refuses before anyone is even asked. A
  // credential must never reach the approval dialog, where it would be one
  // click from history.
  writeFileSync(
    path.join(workspace, 'src', 'config.ts'),
    `export const KEY = "sk-ant-api03-${'A1b2C3d4'.repeat(6)}";\n`,
  );
  await api.executeTool(git('stage', { paths: ['src/config.ts'] }));
  const scanned = await api
    .executeTool(
      git('commit', { message: 'chore: add config' }),
      globalThis.AbortSignal.timeout(4_000),
    )
    .then(
      () => 'committed',
      (error) => String(error),
    );
  report(`REAL secret scan: ${scanned.slice(0, 160)}`);
  assert.match(scanned, /secret scan/iu, 'the secret scan refused the commit, before approval');
  await api.executeTool(git('unstage', { paths: ['src/greeting.ts', 'src/config.ts'] }));

  // delete: the file is gone from disk.
  const current = await api.executeTool(
    invocation('workspace.files', 'read', { rootKey: ROOT_KEY, path: 'src/greeting.ts' }),
  );
  await api.executeTool(
    invocation(
      'workspace.files',
      'delete',
      transaction({
        kind: 'delete',
        rootKey: ROOT_KEY,
        path: 'src/greeting.ts',
        beforeHash: hashOf(current),
      }),
    ),
  );
  assert.ok(!existsSync(target), 'delete removed the file from disk');
  report('REAL delete: file gone from disk');
}

module.exports = { runRealTools };
