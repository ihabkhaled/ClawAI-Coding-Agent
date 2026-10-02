import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cwd, execPath, stdout } from 'node:process';

const root = cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const apiContracts = readFileSync(join(root, 'docs', 'API_CONTRACTS.md'), 'utf8');
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
const playwrightRegistryPath = join(root, 'browsers.json');
const ciWorkflowPath = join(root, '.github', 'workflows', 'ci.yml');
const releaseWorkflowPath = join(root, '.github', 'workflows', 'release.yml');
const supplyChainSource = readFileSync(join(root, 'scripts', 'generate-supply-chain.mjs'), 'utf8');
const commands = manifest.contributes.commands.map((command) => command.command);
const uniqueCommands = new Set(commands);
const productionDependencies = Object.keys(manifest.dependencies ?? {}).sort();
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
assert.match(
  readme,
  new RegExp(`Version ${manifest.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} delivers`, 'u'),
  'README runtime foundation must name the current package version',
);
assert.doesNotMatch(readme, /Version 0\.(?:11|40)\.0/u, 'README must not advertise stale versions');
for (const runtimeContract of [
  'toolExecution: true',
  '/chat-messages/runtime/runs',
  '/chat-messages/runtime/runs/:runId/results',
  '/chat-messages/runtime/runs/:runId/steering',
  '/chat-messages/runtime/runs/:runId/cancel',
]) {
  assert.match(
    apiContracts,
    new RegExp(runtimeContract.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    `API contracts must document ${runtimeContract}`,
  );
}
assert.match(gitAttributes, /^\*\.vsix binary$/mu, 'tracked VSIX archives must be marked binary');
assert.deepEqual(rootVsix, [], 'VSIX artifacts must live under builds/, never the repository root');
assert.equal(uniqueCommands.size, commands.length, 'command IDs must be unique');
assert.deepEqual(
  productionDependencies,
  [
    '@homebridge/node-pty-prebuilt-multiarch',
    'chromium-bidi',
    'cross-spawn',
    'jszip',
    'node-pty',
    'playwright-core',
    'zod',
  ],
  'Runtime V2 production dependencies must remain explicit and security-reviewed',
);
// Registration lives in extension.ts and in the command modules it wires up;
// a command counts only if its id appears in a file that calls registerCommand.
const registrationSource = [
  extensionSource,
  ...readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .filter((source) => source.includes('registerCommand')),
].join('\n');
for (const command of commands) {
  assert.match(
    registrationSource,
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
assert.equal(
  existsSync(playwrightRegistryPath),
  true,
  'Packaged Playwright browser registry metadata is missing',
);
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
assert.match(ciWorkflow, /npm run check:quality/u, 'CI must run the split quality lane');
assert.match(ciWorkflow, /npm run check:unit/u, 'CI must run the split unit and coverage lane');
assert.match(
  manifest.scripts['check:quality'],
  /format:check[\s\S]+l10n:verify[\s\S]+lint[\s\S]+typecheck[\s\S]+scan:paths[\s\S]+inventory:verify[\s\S]+package:audit/u,
  'quality checks must preserve formatting, localization, lint, type, path, inventory and package gates',
);
assert.match(
  manifest.scripts['check:unit'],
  /coverage:scope[\s\S]+npm test/u,
  'unit checks must include critical coverage scope and tests',
);
assert.match(ciWorkflow, /name:\s*Version/u, 'CI must expose a separate version gate');
assert.match(
  ciWorkflow,
  /scripts\/verify-version-bump\.mjs/u,
  'CI must enforce a new delivery minor',
);
assert.match(ciWorkflow, /name:\s*Extension host/u, 'CI must expose extension-host separately');
assert.match(ciWorkflow, /npm run test:playwright/u, 'CI must run Playwright in its own lane');
assert.match(
  ciWorkflow,
  /npm audit --omit=dev --audit-level=high/u,
  'CI must audit production dependencies',
);
assert.match(ciWorkflow, /name:\s*Package VSIX/u, 'CI must package only in the final job');
assert.match(
  ciWorkflow,
  /needs:[\s\S]+version[\s\S]+quality[\s\S]+unit[\s\S]+extension-host[\s\S]+webview[\s\S]+audit/u,
  'final packaging must wait for every split gate',
);
assert.match(
  ciWorkflow,
  /npm run supply-chain/u,
  'final package job must generate supply-chain evidence',
);
assert.match(
  ciWorkflow,
  /name:\s*clawai-coding-agent-release/u,
  'CI must upload one release artifact after all gates',
);
assert.equal(existsSync(releaseWorkflowPath), true, 'release workflow is missing');
const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf8');
assert.match(
  releaseWorkflow,
  /actions:\s*read/u,
  'release workflow needs artifact read permission',
);
assert.match(
  releaseWorkflow,
  /contents:\s*write/u,
  'release workflow needs contents write permission',
);
assert.match(
  releaseWorkflow,
  /workflow_run:[\s\S]+workflows:[\s\S]+- CI[\s\S]+completed/u,
  'release must start only after CI completes',
);
assert.match(
  releaseWorkflow,
  /workflow_run\.conclusion == 'success'[\s\S]+workflow_run\.head_branch == 'main'/u,
  'release must publish only a successful main push',
);
assert.match(
  releaseWorkflow,
  /actions\/download-artifact@v4[\s\S]+clawai-coding-agent-release/u,
  'release must consume the exact final CI artifact',
);
assert.match(
  releaseWorkflow,
  /already exists\. Every main push must carry a fresh delivery minor/u,
  'release must reject a reused version tag',
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
assert.match(
  releaseWorkflow,
  /@vscode\/vsce publish/u,
  'every verified release must publish the final VSIX to the VS Code Marketplace',
);
assert.match(
  releaseWorkflow,
  /VSCE_PAT is required/u,
  'Marketplace credentials must be required instead of silently skipping publication',
);
assert.match(
  releaseWorkflow,
  /clawai-coding-agent-\$\{VERSION\}\.vsix/u,
  'release workflow must attach and publish the versioned VSIX',
);
assert.match(
  releaseWorkflow,
  /source\?\.digest\?\.gitCommit !== sourceSha/u,
  'release workflow must bind downloaded provenance to the successful CI commit',
);
assert.match(
  releaseWorkflow,
  /The attached VSIX is the exact final artifact produced after every CI gate passed/u,
  'release notes must state the final-artifact ordering',
);
assert.match(supplyChainSource, /CycloneDX/u, 'release must generate a CycloneDX SBOM');
assert.match(supplyChainSource, /SPDX-2\.3/u, 'release must generate an SPDX SBOM');
assert.match(
  supplyChainSource,
  /readReleaseIdentity/u,
  'release provenance must read the source Git identity',
);
assert.match(
  supplyChainSource,
  /gitCommit/u,
  'release provenance must contain the source Git commit digest',
);
assert.match(
  supplyChainSource,
  /https:\/\/in-toto\.io\/Statement\/v1/u,
  'release must generate in-toto provenance',
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
const webviewScript = readFileSync(join(root, 'media', 'chat.js'), 'utf8');
assert.doesNotMatch(webviewScript, /\.innerHTML\s*=/u, 'webview must not assign untrusted HTML');
// The host blocks secret-bearing attachments either way, so losing this check
// costs no safety and every explanation: the user would see only the generic
// "invalid request". It is asserted here because it is the kind of duplicated
// mirror that gets deleted as dead weight.
assert.match(
  webviewScript,
  /isSecretBearingAttachmentName/u,
  'webview must screen secret-bearing attachment names',
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
  '.clawai-lab/**',
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
  '.superpowers/**',
  'test-results/**',
  '.husky/**',
  '.githooks/**',
  '.vscode-test/**',
]) {
  assert.equal(ignore.includes(path), true, `${path} must be excluded`);
}

/**
 * Nothing from a tooling directory may reach the published artifact.
 *
 * `.husky/_` is generated by `npx husky` and gitignored, so it exists on a
 * developer's machine and never on a fresh CI checkout. Packaged, it made the
 * committed VSIX and the one CI rebuilds differ by nineteen files, which the
 * release gate correctly refused — while every local gate stayed green, because
 * locally the two builds agreed with each other.
 */
// Invoked through Node against vsce's own entry point rather than through a
// shell: a shell would need the arguments concatenated, and the CLI's name
// differs by platform.
const packagedFiles = execFileSync(
  execPath,
  [join(root, 'node_modules', '@vscode', 'vsce', 'vsce'), 'ls'],
  { encoding: 'utf8' },
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
assert.deepEqual(
  packagedFiles.filter((file) => file.startsWith('.')),
  [],
  'no dot-directory may be packaged into the VSIX',
);

/**
 * The Marketplace listing carries only what the editor runs or the listing shows.
 *
 * A repository-root file not named here (a tool config, a lab script, a stray
 * archive) fails the audit instead of shipping silently; so does any test,
 * fixture, screenshot, worktree or source-map path anywhere in the package.
 */
const ROOT_FILES = new Set([
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'browsers.json',
  'package.json',
]);
const stray = packagedFiles.filter((file) => {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized.includes('/')) {
    return !ROOT_FILES.has(normalized) && !/^package\.nls(\.[a-z]{2})?\.json$/u.test(normalized);
  }
  return /(^|\/)(tests?|fixtures?|screenshots?|\.worktrees|worktrees)\/|\.(test|spec)\.|\.map$|\.vsix$/iu.test(
    normalized,
  );
});
assert.deepEqual(stray, [], 'files that must not be packaged into the VSIX');
const shippedBundles = [
  'dist/extension.js',
  'dist/headless.mjs',
  'dist/sdk.mjs',
  'dist/playwright-runtime.js',
];
// The bundles exist only after a build. `check:quality` runs this audit on a fresh
// checkout before any build, so the presence of the bundles is enforced when a
// build output is there to inspect (the package job builds first) and skipped
// when it is not, instead of failing every quality run.
const built = existsSync(join(root, 'dist', 'extension.js'));
for (const bundle of built ? shippedBundles : []) {
  assert.equal(
    packagedFiles.includes(bundle),
    true,
    `${bundle} must be packaged (playwright-core stays a separate lazily loaded file)`,
  );
}

stdout.write(
  `package:audit OK — ${String(commands.length)} commands, ${String(locales.length + 1)} locales, strict CSP, no secret settings\n`,
);
