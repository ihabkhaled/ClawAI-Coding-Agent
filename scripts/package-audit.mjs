import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cwd, stdout } from 'node:process';

const root = cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const gitAttributes = readFileSync(join(root, '.gitattributes'), 'utf8');
const configurationSource = readFileSync(
  join(root, 'src', 'services', 'configuration-service.ts'),
  'utf8',
);
const extensionSource = readFileSync(join(root, 'src', 'extension.ts'), 'utf8');
const backendClientSource = readFileSync(join(root, 'src', 'backend', 'backend-client.ts'), 'utf8');
const clawIconPathSource = readFileSync(join(root, 'src', 'views', 'claw-icon-path.ts'), 'utf8');
const webviewSource = readFileSync(join(root, 'src', 'webview', 'chat-view-provider.ts'), 'utf8');
const webviewMarkup = readFileSync(join(root, 'src', 'webview', 'chat-markup.ts'), 'utf8');
const clawIcon = readFileSync(join(root, 'resources', 'claw.svg'), 'utf8');
const darkClawIconPath = join(root, 'resources', 'claw-dark.svg');
const lightClawIconPath = join(root, 'resources', 'claw-light.svg');
const ciWorkflowPath = join(root, '.github', 'workflows', 'ci.yml');
const releaseWorkflowPath = join(root, '.github', 'workflows', 'release.yml');
const commands = manifest.contributes.commands.map((command) => command.command);
const uniqueCommands = new Set(commands);
const rootVsix = readdirSync(root).filter((entry) => entry.endsWith('.vsix'));

assert.match(
  manifest.version,
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u,
  'release version must be valid SemVer',
);
assert.equal(lockfile.version, manifest.version, 'package-lock version must match package version');
assert.equal(
  lockfile.packages[''].version,
  manifest.version,
  'package-lock root package version must match package version',
);
assert.match(
  changelog,
  new RegExp(`^## ${manifest.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'),
  'CHANGELOG must contain a heading for the package version',
);
assert.match(gitAttributes, /^\*\.vsix binary$/mu, 'tracked VSIX archives must be marked binary');
assert.deepEqual(rootVsix, [], 'VSIX artifacts must live under builds/, never the repository root');
assert.equal(uniqueCommands.size, commands.length, 'command IDs must be unique');
for (const command of commands) {
  assert.match(
    extensionSource,
    new RegExp(`['"]${command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]`, 'u'),
    `${command} is contributed but not registered`,
  );
}

assert.equal(
  manifest.contributes.configuration.properties['clawAI.backendUrl'].default,
  'https://claw.local',
  'first-run backend must default to the local ClawAI app origin',
);
assert.doesNotMatch(
  configurationSource,
  /showInputBox/u,
  'backend configuration must stay inside the ClawAI connection gateway',
);
assert.doesNotMatch(
  backendClientSource,
  /\/auth\/login|password/iu,
  'the extension must authorize in the browser and never expose password login',
);
assert.match(
  webviewMarkup,
  /id="connectionGate"[\s\S]+id="backendUrlInput"[\s\S]+id="connectButton"/u,
  'webview must provide the focused backend connection gateway',
);
assert.match(
  extensionSource,
  /\['clawAI\.connect', \(\) => coordinator\.openChat\(\)\]/u,
  'Connect command must open the in-extension gateway',
);
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
assert.match(
  extensionSource,
  /participant\.iconPath = createClawIconPath\(context\.extensionUri\);/u,
  'Chat participant must use the themed claw scratch mark',
);
assert.doesNotMatch(
  clawIconPathSource,
  /icon\.png/u,
  'Navigation icon paths must not use the Marketplace artwork',
);
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
assert.equal(existsSync(ciWorkflowPath), true, 'CI workflow is missing');
const ciWorkflow = readFileSync(ciWorkflowPath, 'utf8');
assert.match(
  ciWorkflow,
  /path:\s*['"]?builds\/\*\.vsix['"]?/u,
  'CI must upload packaged VSIX artifacts from builds/',
);
assert.equal(existsSync(releaseWorkflowPath), true, 'main-branch release workflow is missing');
const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf8');
assert.match(releaseWorkflow, /contents:\s*write/u, 'release workflow needs contents write only');
assert.match(
  releaseWorkflow,
  /push:\s*\n\s+branches:\s*\n\s+- main/u,
  'every main push must enter the release workflow',
);
assert.match(
  releaseWorkflow,
  /gh release create/u,
  'release workflow must create a GitHub Release',
);
assert.match(
  releaseWorkflow,
  /--notes-file\s+"\$\{RUNNER_TEMP\}\/release-notes\.md"/u,
  'release workflow must publish full versioned release notes',
);
assert.doesNotMatch(
  releaseWorkflow,
  /--generate-notes/u,
  'release workflow must not replace curated release notes with generated notes',
);
assert.match(
  releaseWorkflow,
  /builds\/clawai-coding-agent-\$\{\{ steps\.version\.outputs\.version \}\}\.vsix/u,
  'release workflow must attach the versioned VSIX',
);
assert.match(
  releaseWorkflow,
  /git ls-files --error-unmatch/u,
  'release workflow must require the versioned VSIX to be tracked in git',
);
assert.match(
  releaseWorkflow,
  /diff -qr/u,
  'release workflow must compare the committed VSIX contents with a fresh package',
);
assert.equal(
  manifest.scripts.package,
  'npm run build && node scripts/package-extension.mjs',
  'packaging must write the versioned VSIX through the builds script',
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
  'builds/**',
  '.github/**',
  'node_modules/**',
  'dist/**/*.map',
  'playwright-report/**',
  'playwright.config.ts',
  'skills/**',
  'test-results/**',
]) {
  assert.equal(ignore.includes(path), true, `${path} must be excluded`);
}

stdout.write(
  `package:audit OK — ${String(commands.length)} commands, ${String(locales.length + 1)} locales, strict CSP, no secret settings\n`,
);
