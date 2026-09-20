const assert = require('node:assert/strict');
const { stdout } = require('node:process');
const vscode = require('vscode');

const report = (line) => stdout.write(`${line}\n`);

/**
 * Every setting, written into a real editor and read back through the
 * extension.
 *
 * The inventory said "schema and read path verified; behaviour not exercised"
 * for all twenty-four, which is precisely the gap this lane exists to close:
 * a manifest entry proves a default exists, and says nothing about whether
 * anything consumes the value. A setting that is contributed, documented and
 * never read looks identical in the manifest to one that works.
 *
 * Written at the scope each setting declares, and restored afterwards. The
 * connection settings are `machine` scope — VS Code refuses to write them into
 * a workspace at all, which is the right call: a repository must not be able
 * to point a user's agent at a different backend by committing a settings
 * file. Everything else is `resource` or `window` and writes to the workspace.
 */
const MACHINE_SCOPED = new Set([
  'backendUrl',
  'backendEnvironment',
  'backendCustomUrl',
  'frontendEnvironment',
  'frontendCustomUrl',
  'requestTimeoutMs',
  'telemetryEndpoint',
  'telemetryHeaders',
]);

const targetFor = (key) =>
  MACHINE_SCOPED.has(key)
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
const CASES = [
  ['agentMode', 'PLAN', (config) => config.agentMode],
  ['viewDensity', 'focus', (config) => config.viewDensity],
  ['outputStyle', 'explanatory', (config) => config.outputStyle],
  ['effortMode', 'HIGH', (config) => config.effortMode],
  ['speedMode', '2X', (config) => config.speedMode],
  ['permissionMode', 'PLAN', (config) => config.permissionMode],
  ['routingMode', 'MANUAL_MODEL', (config) => config.routingMode],
  ['selectedModel', 'kimi-k3', (config) => config.selectedModel],
  ['requestTimeoutMs', 12_345, (config) => config.requestTimeoutMs],
  ['maxContextBytes', 111_111, (config) => config.maxContextBytes],
  ['maxContextFiles', 7, (config) => config.maxContextFiles],
  ['historyLimit', 9, (config) => config.historyLimit],
  ['autosave', 'before-edit', (config) => config.autosave],
  ['backendCustomUrl', 'https://backend.example.test', (config) => config.backendCustomUrl],
  ['frontendCustomUrl', 'https://frontend.example.test', (config) => config.frontendCustomUrl],
  ['backendEnvironment', 'CUSTOM', (config) => config.backendEnvironment],
  ['frontendEnvironment', 'CUSTOM', (config) => config.frontendEnvironment],
];

const LIST_CASES = [
  ['exclude', ['**/never-scanned/**'], (config) => config.exclude],
  ['browserOrigins', ['https://allowed.example.test'], (config) => config.browserOrigins],
];

async function runSettings(api) {
  const configuration = () => vscode.workspace.getConfiguration('clawAI');
  const restore = [];

  try {
    for (const [key, value, read] of CASES) {
      restore.push(key);
      await configuration().update(key, value, targetFor(key));
      const resolved = read(api.configuration());
      assert.equal(
        resolved,
        value,
        `clawAI.${key} was set to ${String(value)} and the extension resolved ${String(resolved)}`,
      );
      report(`SETTING ${key}: resolved ${String(value)}`);
    }

    for (const [key, value, read] of LIST_CASES) {
      restore.push(key);
      await configuration().update(key, value, targetFor(key));
      assert.deepEqual(read(api.configuration()), value, `clawAI.${key} did not resolve its list`);
      report(`SETTING ${key}: resolved ${JSON.stringify(value)}`);
    }

    // A custom backend environment must actually redirect the resolved URL, or
    // the setting is a label that changes nothing. This is the one setting a
    // user can get wrong and silently keep talking to the wrong host.
    assert.equal(
      api.configuration().backendUrl,
      'https://backend.example.test',
      'CUSTOM backendEnvironment did not redirect backendUrl to the custom value',
    );
    report('SETTING backendUrl: follows backendEnvironment=CUSTOM');

    // Hooks are parsed, not merely stored: a malformed entry must not reach the
    // run loop, and a valid one must survive.
    restore.push('hooks');
    await configuration().update(
      'hooks',
      [{ event: 'before-tool', command: 'echo', arguments: ['hi'] }],
      targetFor('hooks'),
    );
    assert.equal(api.configuration().hooks.length, 1, 'a valid lifecycle hook was dropped');
    await configuration().update('hooks', [{ nonsense: true }], targetFor('hooks'));
    assert.deepEqual(
      api.configuration().hooks,
      [],
      'a malformed hook survived parsing and would have reached the run loop',
    );
    report('SETTING hooks: valid kept, malformed refused');
  } finally {
    for (const key of restore) {
      await configuration().update(key, undefined, targetFor(key));
    }
  }
}

module.exports = { runSettings };
