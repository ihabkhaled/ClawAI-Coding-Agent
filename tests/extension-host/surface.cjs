const assert = require('node:assert/strict');
const { stdout } = require('node:process');
const { setTimeout, clearTimeout } = require('node:timers');
const vscode = require('vscode');
const manifest = require('../../package.json');

const report = (line) => stdout.write(`${line}\n`);
const COMMAND_BUDGET_MS = 15_000;

/**
 * Commands that cannot be executed headlessly, with the reason. Everything else
 * runs for real with every prompt answered "cancelled".
 */
const SKIPPED = new Map([
  ['clawAI.openConversationInNewWindow', 'forceNewWindow would spawn a second, unmanaged editor'],
  [
    'clawAI.pairDevice',
    'by design waits for a phone to approve (or the code to expire) against a live backend',
  ],
  ['clawAI.openTerminal', 'creates a real terminal process in the shared host'],
]);

const PROMPTS = [
  'showQuickPick',
  'showInputBox',
  'showInformationMessage',
  'showWarningMessage',
  'showErrorMessage',
  'showOpenDialog',
  'showSaveDialog',
];

/** Answers every prompt with "dismissed" and reports which ones could not be stubbed. */
function cancelPrompts() {
  const originals = [];
  const unstubbed = [];
  for (const name of PROMPTS) {
    const original = vscode.window[name];
    try {
      vscode.window[name] = () => Promise.resolve(undefined);
      originals.push([name, original]);
    } catch {
      unstubbed.push(name);
    }
  }
  return {
    unstubbed,
    restore: () => {
      for (const [name, original] of originals) vscode.window[name] = original;
    },
  };
}

async function withinBudget(command) {
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${command} did not settle within ${String(COMMAND_BUDGET_MS)} ms`));
    }, COMMAND_BUDGET_MS);
  });
  try {
    await Promise.race([vscode.commands.executeCommand(command), budget]);
  } finally {
    clearTimeout(timer);
  }
}

async function runEveryCommand() {
  const contributed = manifest.contributes.commands.map((entry) => entry.command);
  const stub = cancelPrompts();
  report(`PROMPT STUBS: unstubbed=[${stub.unstubbed.join(',')}]`);
  const failures = [];
  let executed = 0;
  try {
    for (const command of contributed) {
      const reason = SKIPPED.get(command);
      if (reason !== undefined) {
        report(`COMMAND ${command}: skipped (${reason})`);
        continue;
      }
      try {
        await withinBudget(command);
        executed += 1;
        report(`COMMAND ${command}: ok`);
      } catch (error) {
        failures.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
        report(`COMMAND ${command}: FAILED ${failures[failures.length - 1]}`);
      }
    }
  } finally {
    stub.restore();
  }
  report(
    `COMMANDS: ${String(executed)} executed, ${String(SKIPPED.size)} skipped, ${String(failures.length)} failed of ${String(contributed.length)}`,
  );
  assert.deepEqual(failures, [], 'contributed commands threw with no preconditions');
}

async function runEveryView(api) {
  const views = Object.values(manifest.contributes.views).flat();
  const registered = new Set(api.viewIds());
  for (const view of views) {
    if (view.type === 'webview') continue;
    assert.ok(registered.has(view.id), `${view.id} has a registered tree provider`);
    const rows = await api.viewRowCount(view.id);
    assert.equal(typeof rows, 'number', `${view.id} returned its children`);
    report(`VIEW ${view.id}: ${String(rows)} rows`);
  }
}

function runEverySetting() {
  const configuration = vscode.workspace.getConfiguration('clawAI');
  const properties = Object.entries(manifest.contributes.configuration.properties);
  for (const [fullKey, schema] of properties) {
    const key = fullKey.replace(/^clawAI\./u, '');
    const inspected = configuration.inspect(key);
    assert.ok(inspected, `${fullKey} is readable`);
    assert.deepEqual(inspected.defaultValue, schema.default, `${fullKey} default matches manifest`);
    report(`SETTING-DEFAULT ${fullKey}: ${JSON.stringify(inspected.defaultValue)}`);
  }
}

async function runPluginsView(api) {
  await vscode.commands.executeCommand('clawAI.refreshPlugins');
  const rows = await api.viewRowCount('clawAI.plugins');
  assert.ok(rows >= 1, `the Plugins view lists the fixture plugin (rows=${String(rows)})`);
  report(`PLUGINS VIEW: ${String(rows)} row(s) from fixture .clawai/plugins/qa-fixture`);
}

async function runSurface(api) {
  runEverySetting();
  await runEveryView(api);
  await runPluginsView(api);
  await runEveryCommand();
}

module.exports = { runSurface };
