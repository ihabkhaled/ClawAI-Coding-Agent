const assert = require('node:assert/strict');
const vscode = require('vscode');

const { runActivation } = require('./activation.cjs');
const { runRealTools } = require('./real-tools.cjs');
const { runRuntimeTools } = require('./runtime-tools.cjs');
const { runSettings } = require('./settings.cjs');

async function run() {
  await runActivation();
  const extension = vscode.extensions.getExtension('clawai.clawai-coding-agent');
  const api = await extension.activate();
  // The test API exists only under the test runner. Its presence here, and its
  // absence from an installed extension, are both part of the contract.
  assert.ok(api, 'the extension exposes its test API under the test runner');
  await runRealTools(api);
  await runRuntimeTools(api);
  await runSettings(api);
}

module.exports = { run };
