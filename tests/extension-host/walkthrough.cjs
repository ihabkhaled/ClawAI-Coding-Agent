const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { stdout } = require('node:process');
const vscode = require('vscode');
const manifest = require('../../package.json');
const nls = require('../../package.nls.json');

const WALKTHROUGH_ID = 'clawai.clawai-coding-agent#clawAI.gettingStarted';
const COMMAND_LINK = /\(command:([\w.]+)\)/gu;
const extensionRoot = () =>
  vscode.extensions.getExtension('clawai.clawai-coding-agent').extensionPath;

/** Every command id a step points at: buttons in its description and its completion events. */
function commandsOf(step) {
  const description = nls[step.description.replaceAll('%', '')];
  assert.ok(description, `${step.id}: description key resolves in package.nls.json`);
  const linked = [...description.matchAll(COMMAND_LINK)].map((match) => match[1]);
  const completion = step.completionEvents
    .filter((event) => event.startsWith('onCommand:'))
    .map((event) => event.slice('onCommand:'.length));
  return [...linked, ...completion];
}

async function runWalkthrough() {
  const [walkthrough] = manifest.contributes.walkthroughs;
  assert.equal(walkthrough.id, 'clawAI.gettingStarted');
  assert.ok(
    walkthrough.steps.length >= 6 && walkthrough.steps.length <= 7,
    'the walkthrough has six or seven steps',
  );

  const registered = new Set(await vscode.commands.getCommands(true));
  for (const step of walkthrough.steps) {
    const media = step.media.markdown;
    assert.ok(existsSync(join(extensionRoot(), media)), `${step.id}: media file ${media} exists`);
    const commands = commandsOf(step);
    assert.ok(commands.length > 0, `${step.id}: points at a command`);
    for (const command of commands) {
      assert.ok(registered.has(command), `${step.id}: command ${command} is registered`);
    }
    stdout.write(`WALKTHROUGH_STEP ${step.id}: ${commands.join(', ')}\n`);
  }

  // The real Getting Started page: opening must resolve the contributed id.
  await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
  stdout.write(`WALKTHROUGH_OPENED ${WALKTHROUGH_ID}\n`);
}

module.exports = { runWalkthrough };
