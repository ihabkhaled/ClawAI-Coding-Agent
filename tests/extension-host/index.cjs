const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('clawai.clawai-coding-agent');
  assert.ok(extension, 'ClawAI extension is installed in the test host');

  const start = Date.now();
  await extension.activate();
  assert.ok(extension.isActive, 'ClawAI extension activates');
  assert.ok(Date.now() - start < 2_000, 'activation stays below the 2 second host budget');

  const commands = await vscode.commands.getCommands(true);
  const contributed = extension.packageJSON.contributes.commands.map((entry) => entry.command);
  assert.ok(contributed.length >= 20, 'the complete coding-agent command surface is contributed');
  for (const command of contributed) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }
}

module.exports = { run };
