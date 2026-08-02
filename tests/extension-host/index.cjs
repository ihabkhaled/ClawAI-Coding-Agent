const assert = require('node:assert/strict');
const vscode = require('vscode');
const manifest = require('../../package.json');

async function run() {
  const extension = vscode.extensions.getExtension('clawai.clawai-coding-agent');
  assert.ok(extension, 'ClawAI extension is installed in the test host');
  assert.equal(
    extension.packageJSON.version,
    manifest.version,
    `the v${manifest.version} release activates`,
  );

  const start = Date.now();
  await extension.activate();
  assert.ok(extension.isActive, 'ClawAI extension activates');
  assert.ok(Date.now() - start < 2_000, 'activation stays below the 2 second host budget');

  const commands = await vscode.commands.getCommands(true);
  const contributed = extension.packageJSON.contributes.commands.map((entry) => entry.command);
  const configuration = extension.packageJSON.contributes.configuration.properties;
  assert.ok(contributed.length >= 20, 'the complete coding-agent command surface is contributed');
  for (const command of contributed) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }
  assert.deepEqual(configuration['clawAI.agentMode'].enum, ['AUTO', 'PLAN']);
  assert.deepEqual(configuration['clawAI.permissionMode'].enum, [
    'PLAN',
    'ASK',
    'AUTO_EDIT',
    'AUTONOMOUS_SCOPED',
    'ENTERPRISE_LOCKED',
  ]);
  assert.ok(
    !extension.packageJSON.activationEvents.includes('onUri'),
    'loopback browser authorization does not expose a custom URI callback',
  );
}

module.exports = { run };
