# Plugins, marketplaces and hooks

> Users can install bundles of skills, commands, hooks, MCP servers and agents from marketplaces, and run their own commands at points of an agent run, all under approval and signature rules.

## Business why

- Plugins and hooks are rows F078 (Hooks), F080 (Plugin GUI) and F081 (Plugin marketplaces) of the 108-row Claude parity program ([audit F056-F087](../../parity/AUDIT_F056_F087.md), [HANDOVER](../../parity/HANDOVER.md)).
- Organizations get a say over which marketplaces and publishers are allowed (`allowedPluginMarketplaces`, `trustedPluginPublishers`), which is what lets a company allow extensions at all ([ADR 0006](../../adr/0006-plugin-publisher-signatures.md)).
- Revenue or plan value of the plugin ecosystem: _Unknown - ask the owner and record the answer._

## Product why

- User problem: share a team's agent setup (skills, slash commands, output styles, hooks, MCP servers, sub-agent presets) as one installable unit, and run checks or notifications around a run.
- Who: developers, team leads who publish a catalog, organization admins.
- How it shows up:
  - Commands: `clawAI.managePlugins`, `browsePluginMarketplaces`, `enablePlugin`, `disablePlugin`, `uninstallPlugin`, `refreshPlugins`.
  - The **Plugins** view (`clawAI.plugins`) with enable, disable and uninstall, a signed or unsigned badge.
  - Settings: `clawAI.pluginMarketplaces`, `trustedPluginPublishers`, `pluginSignaturePolicy` (`off`, `warn`, `require`), `allowPrivatePluginSources`, `hooks`.
  - A plugin is a folder with `clawai-plugin.json`; a catalog is `clawai-marketplace.json`.
- Acceptance criteria in the docs:
  - A plugin found in an opened repository does nothing until the user enables workspace plugins, and only in a trusted workspace ([ADR 0007](../../adr/0007-secure-by-default-plugins-hooks-network.md)).
  - A plugin hook runs only after approval bound to a digest of its commands; a changed command needs approval again.
  - A hook never starts without the policy having allowed the tool call first.

## How it works

Key files:

- Manifest and paths: `src/core/plugin-manifest.ts`, `plugin-manifest.schema.ts`, `plugin-manifest.constants.ts`, `plugin-path.ts`.
- Marketplaces: `src/core/plugin-marketplace.ts`, `plugin-marketplace-policy.ts`, `plugin-git-marketplace.ts`, `src/services/plugin-marketplace-service.ts`.
- Signatures: `src/core/plugin-signature.ts`, `plugin-signature-policy.ts`, `scripts/sign-plugin-catalog.mjs`.
- Install and network: `src/services/plugin-store.ts`, `src/infrastructure/plugin-download.ts`, `plugin-archive.ts`, `plugin-git-clone.ts`, `plugin-network-guard.ts`, `src/core/private-address.ts`, `src/core/git-hardening.ts`.
- Plugin contributions: `src/core/plugin-mcp.ts` (servers), `plugin-agents.ts` (sub-agent presets), `src/services/plugin-skill-source.ts`.
- Hooks: `src/core/lifecycle-hook.ts`, `src/services/lifecycle-hook-service.ts`, `src/infrastructure/vscode-hook-runner.ts`, `src/core/plugin-hook-approval.ts`.
- UI: `src/views/plugin-tree-provider.ts`, `src/services/register-plugin-commands.ts`.

Plugin rules (from [THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md)):

- Manifest at most 64 KB, strict schema. At most 500 files, 10 MiB, depth 8.
- Every contributed path is a contained relative path: forward slashes, no drive letter, no leading slash, no `..`.
- A plugin never starts a process itself. Its MCP servers are only declared; the MCP client starts them under MCP policy ([mcp](mcp.md)). Plugin hooks use the lifecycle-hook schema, at most 20.
- Profile-side state (`plugin-state.json`, `plugin-provenance.json`) keeps switches and signer; nothing is written into the repository.

Marketplace rules:

- Every catalog entry pins a `sha256`; a mismatch refuses the install.
- Sources: an https `.zip`, a catalog-relative path, a local folder, or `git+https://...#ref` (shallow clone through the bounded runner, no shell, `GIT_TERMINAL_PROMPT=0`, 120 s timeout, 64 KB output cap, fresh on every open).
- Signature: detached Ed25519 over the canonical JSON of `name`, `publisher`, `sha256`, `source`, `version`. Verdicts `signed`, `unsigned`, `unknown-publisher`, `invalid`. Default policy is `warn`.
- Private, loopback, link-local and metadata addresses are refused, including after a redirect, unless `allowPrivatePluginSources` is on.

Hooks:

- Events: `run-start`, `run-end`, `before-tool`, `after-tool`. Optional `toolGlob`. `blocking` counts only for `before-tool`.
- Timeout 10 s; a timeout is silence, not a refusal. Up to 50 hooks in settings.
- Configured in VS Code settings (`clawAI.hooks`), not in `.clawai`, so that cloning a repository cannot run code.

## Decisions

- Hooks live in settings, not `.clawai`. Why: a hook runs a command and project config may only tighten. Rejected: reading hooks from workspace content. ([audit F078](../../parity/AUDIT_F056_F087.md))
- Detached Ed25519 publisher signatures over a fixed canonical text; default `warn`. Why: a hash proves the download matches the catalog, not who wrote the entry. Rejected: `require` as default (would break existing unsigned marketplaces). ([ADR 0006](../../adr/0006-plugin-publisher-signatures.md))
- Secure by default: workspace plugins off, hooks approved by digest, private addresses refused, git neutralized, fail closed. Rejected: automatic enablement of repository plugins. ([ADR 0007](../../adr/0007-secure-by-default-plugins-hooks-network.md))
- Organization list replaces the user's trusted keys; a project list may only narrow ([ADR 0006](../../adr/0006-plugin-publisher-signatures.md)).

## History

- 2026-09-10: lifecycle hooks ship (1.9.0, commit "lifecycle hooks, configured where they cannot be a supply chain (F078)"). Before: none. After: four events, tool globs, blocking flag.
- 2026-09-29: plugins and plugin marketplaces ship in 1.82.0.
- 2026-09-30: 1.83.0 adds the Plugins view, plugin MCP servers and agents, git marketplaces and the organization allowlist.
- 2026-09-30: 1.84.0 adds publisher signatures ([ADR 0006](../../adr/0006-plugin-publisher-signatures.md)).
- 2026-09-30: 1.85.0 secure defaults: project plugins stay off until approved, hooks are approved again when commands change, plugin downloads refuse private addresses, git cannot run hidden repository settings.
- 2026-10-01 to later: no further plugin changes appear in the changelog; later versions do not mention plugins.

## Tests and evidence

Unit tests: `plugin-manifest.test.ts`, `plugin-marketplace.test.ts`, `plugin-marketplace-service.test.ts`, `organization-marketplace-allowlist.test.ts`, `plugin-signature.test.ts`, `plugin-signature-install.test.ts`, `plugin-store.test.ts`, `plugin-commands.test.ts`, `plugin-download-failures.test.ts`, `plugin-git-clone.test.ts`, `plugin-network-guard.test.ts`, `plugin-hook-approval.test.ts`, `lifecycle-hook.test.ts`, `lifecycle-hook-service.test.ts`, `mcp-registration-plugins.test.ts`. A fixture plugin lives in `tests/fixtures/workspace/.clawai/plugins/qa-fixture/`.

Host proof: 1.79.0 records that hooks are asserted to be parsed (a valid one survives, a malformed one is refused) in the real extension host ([CHANGELOG](../../../CHANGELOG.md), 1.79.0).

Not proven: signature code was uncommitted when the threat model was written and the doc says to verify before relying on it ([THREAT_MODEL_RUNTIME_V2](../../THREAT_MODEL_RUNTIME_V2.md), known gaps). The same file notes JSON Schemas for `clawai-plugin.json` and `clawai-marketplace.json` do not exist ([ROADMAP](../../ROADMAP.md)).

## Known gaps and risks

- F081 stays PARTIAL: agent-service must serve `allowedPluginMarketplaces` in the policy response; the client reads it once it exists ([PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)).
- Default `warn` means an unsigned plugin installs with a warning.
- No revocation list or key rotation protocol; rotate by changing the trusted key.
- No published JSON Schemas for the manifest or the catalog.
- A private-network marketplace is refused by default; the intended escape is an organization allowlist, "decided separately" ([ADR 0007](../../adr/0007-secure-by-default-plugins-hooks-network.md)).
- ADR 0007 is marked "in progress"; check the code for what landed.

## Open questions

- _Unknown - ask the owner and record the answer._ Is there an official ClawAI marketplace and who publishes to it?
- _Unknown - ask the owner and record the answer._ When should the default signature policy move from `warn` to `require`?
- _Unknown - ask the owner and record the answer._ Business value of plugins for paid plans.
