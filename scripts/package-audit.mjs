import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cwd, stdout } from 'node:process';

const root = cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const extensionSource = readFileSync(join(root, 'src', 'extension.ts'), 'utf8');
const webviewSource = readFileSync(join(root, 'src', 'webview', 'chat-view-provider.ts'), 'utf8');
const webviewMarkup = readFileSync(join(root, 'src', 'webview', 'chat-markup.ts'), 'utf8');
const clawIcon = readFileSync(join(root, 'resources', 'claw.svg'), 'utf8');
const darkClawIconPath = join(root, 'resources', 'claw-dark.svg');
const lightClawIconPath = join(root, 'resources', 'claw-light.svg');
const releaseWorkflowPath = join(root, '.github', 'workflows', 'release.yml');
const commands = manifest.contributes.commands.map((command) => command.command);
const uniqueCommands = new Set(commands);

assert.equal(manifest.version, '0.5.0', 'release version must be 0.5.0');
assert.equal(uniqueCommands.size, commands.length, 'command IDs must be unique');
for (const command of commands) {
  assert.match(
    extensionSource,
    new RegExp(`['"]${command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]`, 'u'),
    `${command} is contributed but not registered`,
  );
}

assert.equal(extname(manifest.icon).toLowerCase(), '.png', 'Marketplace icon must be PNG');
assert.equal(existsSync(join(root, manifest.icon)), true, 'Marketplace icon is missing');
assert.match(clawIcon, /data-claw-scratches="3"/u, 'Activity icon must identify three scratches');
assert.equal(
  [...clawIcon.matchAll(/<path\b/gu)].length,
  3,
  'Activity icon must contain exactly three scratch paths',
);
assert.equal(
  [...clawIcon.matchAll(/<path\b[^>]*fill="currentColor"/gu)].length,
  3,
  'Every scratch must follow the active VS Code theme foreground',
);
assert.equal(existsSync(darkClawIconPath), true, 'Dark-theme scratch icon is missing');
assert.equal(existsSync(lightClawIconPath), true, 'Light-theme scratch icon is missing');
const darkClawIcon = readFileSync(darkClawIconPath, 'utf8');
const lightClawIcon = readFileSync(lightClawIconPath, 'utf8');
assert.equal(
  [...darkClawIcon.matchAll(/<path\b[^>]*fill="#fff(?:fff)?"/giu)].length,
  3,
  'Dark themes must receive three white scratches',
);
assert.equal(
  [...lightClawIcon.matchAll(/<path\b[^>]*fill="#1e1e1e"/giu)].length,
  3,
  'Light themes must receive three dark scratches',
);
assert.doesNotMatch(clawIcon, /<(?:image|text)\b/iu, 'Activity icon must be a pure vector mark');
assert.equal(existsSync(releaseWorkflowPath), true, 'main-branch release workflow is missing');
const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf8');
assert.match(releaseWorkflow, /contents:\s*write/u, 'release workflow needs contents write only');
assert.match(
  releaseWorkflow,
  /gh release create/u,
  'release workflow must create a GitHub Release',
);
assert.match(
  releaseWorkflow,
  /clawai-coding-agent-\$\{\{ steps\.version\.outputs\.version \}\}\.vsix/u,
  'release workflow must attach the versioned VSIX',
);
assert.equal(
  manifest.contributes.viewsContainers.activitybar[0].icon,
  'resources/claw.svg',
  'Activity Bar must use the claw scratch mark',
);
assert.deepEqual(
  manifest.contributes.commands.find((command) => command.command === 'clawAI.openChat').icon,
  {
    light: 'resources/claw-light.svg',
    dark: 'resources/claw-dark.svg',
  },
  'Editor title must use the claw scratch mark',
);
assert.match(
  webviewSource,
  /panel\.iconPath = \{\s+dark: vscode\.Uri\.joinPath\(this\.extensionUri, 'resources', 'claw-dark\.svg'\),\s+light: vscode\.Uri\.joinPath\(this\.extensionUri, 'resources', 'claw-light\.svg'\),\s+\};/u,
  'ClawAI editor tab must use the claw scratch mark',
);
assert.equal(
  manifest.capabilities.untrustedWorkspaces.supported,
  'limited',
  'Workspace Trust capability must remain limited',
);
assert.doesNotMatch(
  JSON.stringify(manifest.contributes.configuration),
  /(?:access.?token|refresh.?token|password|api.?key)/iu,
  'secrets must not be contributed as settings',
);
assert.match(webviewMarkup, /default-src 'none'/u, 'webview CSP must deny by default');
assert.match(webviewSource, /randomBytes/u, 'webview scripts must use a fresh nonce');
assert.doesNotMatch(
  readFileSync(join(root, 'media', 'chat.js'), 'utf8'),
  /\.innerHTML\s*=/u,
  'webview must not assign untrusted HTML',
);

const locales = ['ar', 'de', 'es', 'fa', 'fr', 'hi', 'it', 'ja', 'pt', 'ru', 'th', 'zh'];
const packageMessages = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8'));
const runtimeMessages = JSON.parse(readFileSync(join(root, 'l10n', 'bundle.l10n.json'), 'utf8'));
const expectedPackageKeys = Object.keys(packageMessages).sort();
const expectedRuntimeKeys = Object.keys(runtimeMessages).sort();
for (const locale of locales) {
  const packagePath = join(root, `package.nls.${locale}.json`);
  const runtimePath = join(root, 'l10n', `bundle.l10n.${locale}.json`);
  assert.equal(existsSync(packagePath), true, `${locale} package NLS`);
  assert.equal(existsSync(runtimePath), true, `${locale} runtime NLS`);
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(packagePath, 'utf8'))).sort(),
    expectedPackageKeys,
    `${locale} package NLS key coverage`,
  );
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(runtimePath, 'utf8'))).sort(),
    expectedRuntimeKeys,
    `${locale} runtime NLS key coverage`,
  );
}

const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8');
for (const path of [
  'src/**',
  'tests/**',
  'coverage/**',
  '.github/**',
  'node_modules/**',
  'dist/**/*.map',
  'playwright-report/**',
  'playwright.config.ts',
  'test-results/**',
]) {
  assert.equal(ignore.includes(path), true, `${path} must be excluded`);
}

stdout.write(
  `package:audit OK — ${String(commands.length)} commands, ${String(locales.length + 1)} locales, strict CSP, no secret settings\n`,
);
