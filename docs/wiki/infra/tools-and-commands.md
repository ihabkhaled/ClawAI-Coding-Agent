# Tools and commands

<!-- akinator:generated:begin -->
<!-- Facts extracted from the tree. This block is rewritten on every run;
     write outside it. -->

### Commands

| Command                                                | What                                                                                       | Where defined                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `CI job audit`                                         | Runtime dependency audit                                                                   | `.github/workflows/ci.yml`                      |
| `CI job extension-host`                                | Extension host                                                                             | `.github/workflows/ci.yml`                      |
| `CI job package`                                       | Package VSIX                                                                               | `.github/workflows/ci.yml`                      |
| `CI job quality`                                       | Quality                                                                                    | `.github/workflows/ci.yml`                      |
| `CI job unit`                                          | Unit and coverage                                                                          | `.github/workflows/ci.yml`                      |
| `CI job version`                                       | Version                                                                                    | `.github/workflows/ci.yml`                      |
| `CI job webview`                                       | Webview end-to-end                                                                         | `.github/workflows/ci.yml`                      |
| `CI job release`                                       | Publish verified VSIX                                                                      | `.github/workflows/release.yml`                 |
| `npm run build`                                        | node esbuild.mjs                                                                           | `package.json`                                  |
| `npm run check`                                        | npm run check:quality && npm run check:unit && npm run build                               | `package.json`                                  |
| `npm run check:live`                                   | node scripts/live-agent-check.mjs                                                          | `package.json`                                  |
| `npm run check:quality`                                | npm run format:check && npm run l10n:verify && npm run lint && npm run typecheck && npm... | `package.json`                                  |
| `npm run check:unit`                                   | npm run coverage:scope && npm test                                                         | `package.json`                                  |
| `npm run coverage:scope`                               | node scripts/labs/verify-coverage-scope.mjs                                                | `package.json`                                  |
| `npm run docs:tools`                                   | node scripts/generate-tools-doc.mjs                                                        | `package.json`                                  |
| `npm run format`                                       | prettier --write .                                                                         | `package.json`                                  |
| `npm run format:check`                                 | prettier --check .                                                                         | `package.json`                                  |
| `npm run headless`                                     | node dist/headless.mjs                                                                     | `package.json`                                  |
| `npm run inventory:surface`                            | node scripts/generate-surface-inventory.mjs                                                | `package.json`                                  |
| `npm run inventory:verify`                             | node scripts/generate-surface-inventory.mjs --check                                        | `package.json`                                  |
| `npm run l10n:build`                                   | node scripts/generate-locales.mjs                                                          | `package.json`                                  |
| `npm run l10n:verify`                                  | node scripts/generate-locales.mjs && git diff --exit-code -- l10n package.nls.json pack... | `package.json`                                  |
| `npm run lab:bootstrap`                                | node scripts/labs/bootstrap-lab.mjs                                                        | `package.json`                                  |
| `npm run lab:release-parity`                           | node scripts/labs/verify-release-parity.mjs                                                | `package.json`                                  |
| `npm run lab:score`                                    | node scripts/labs/readiness-score.mjs                                                      | `package.json`                                  |
| `npm run lint`                                         | eslint . --max-warnings=0                                                                  | `package.json`                                  |
| `npm run package`                                      | npm run build && node scripts/package-extension.mjs                                        | `package.json`                                  |
| `npm run package:audit`                                | node scripts/package-audit.mjs                                                             | `package.json`                                  |
| `npm run permissions:matrix`                           | node scripts/generate-permission-matrix.mjs                                                | `package.json`                                  |
| `npm run preflight`                                    | node scripts/ship.mjs --preflight-only                                                     | `package.json`                                  |
| `npm run prepare`                                      | node scripts/install-git-hooks.mjs                                                         | `package.json`                                  |
| `npm run prepublishOnly`                               | npm run check                                                                              | `package.json`                                  |
| `npm run scan:paths`                                   | node scripts/scan-absolute-paths.mjs                                                       | `package.json`                                  |
| `npm run screenshots`                                  | node scripts/capture-screenshots.mjs                                                       | `package.json`                                  |
| `npm run ship`                                         | node scripts/ship.mjs                                                                      | `package.json`                                  |
| `npm run supply-chain`                                 | node scripts/generate-supply-chain.mjs                                                     | `package.json`                                  |
| `npm run test`                                         | vitest run --coverage                                                                      | `package.json`                                  |
| `npm run test:host`                                    | npm run build && node scripts/run-extension-tests.mjs                                      | `package.json`                                  |
| `npm run test:host:installed`                          | node scripts/run-installed-extension-tests.mjs                                             | `package.json`                                  |
| `npm run test:integration`                             | vitest run tests/integration                                                               | `package.json`                                  |
| `npm run test:labs`                                    | node --test tests/labs/*.test.mjs                                                          | `package.json`                                  |
| `npm run test:live-api`                                | node --use-system-ca node_modules/vitest/vitest.mjs run --config vitest.live.config.ts     | `package.json`                                  |
| `npm run test:playwright`                              | playwright test                                                                            | `package.json`                                  |
| `npm run test:unit`                                    | vitest run tests/unit                                                                      | `package.json`                                  |
| `npm run test:vscode`                                  | npm run package && playwright test --config playwright.vscode.config.ts                    | `package.json`                                  |
| `npm run typecheck`                                    | tsc --noEmit                                                                               | `package.json`                                  |
| `npm run version:ensure`                               | node scripts/ensure-release-version.mjs --stage                                            | `package.json`                                  |
| `npm run version:verify`                               | node scripts/verify-version-bump.mjs                                                       | `package.json`                                  |
| `npm run watch`                                        | node esbuild.mjs --watch                                                                   | `package.json`                                  |
| `node scripts/authorization-page-translations.mjs`     | -                                                                                          | `scripts/authorization-page-translations.mjs`   |
| `node scripts/capture-screenshots.mjs`                 | Captures the Marketplace screenshots in docs/images/ from the real webview                 | `scripts/capture-screenshots.mjs`               |
| `node scripts/compaction-offer-translations.mjs`       | The inline "summarize and continue" card shown in the transcript when a                    | `scripts/compaction-offer-translations.mjs`     |
| `node scripts/compare-live-translations.mjs`           | 1.90.0 — the live Compare cards and the judge verdict, plus the four status                | `scripts/compare-live-translations.mjs`         |
| `node scripts/conversation-rewind-translations.mjs`    | Conversation rewind (F059) and checkpoint pairing (F057).                                  | `scripts/conversation-rewind-translations.mjs`  |
| `node scripts/cron-schedule-translations.mjs`          | F099 cron-scheduled tasks: how a cron task is described in the task picker.                | `scripts/cron-schedule-translations.mjs`        |
| `node scripts/emit-sdk-types.mjs`                      | -                                                                                          | `scripts/emit-sdk-types.mjs`                    |
| `node scripts/ensure-release-version.mjs`              | -                                                                                          | `scripts/ensure-release-version.mjs`            |
| `node scripts/fallback-credit-translations.mjs`        | The model-switch notice when the spent credit, not a rate limit, ended a model.            | `scripts/fallback-credit-translations.mjs`      |
| `node scripts/first-run-translations.mjs`              | First-run surfaces: the Getting Started walkthrough (package.nls) and the                  | `scripts/first-run-translations.mjs`            |
| `node scripts/generate-locales.mjs`                    | -                                                                                          | `scripts/generate-locales.mjs`                  |
| `node scripts/generate-permission-matrix.mjs`          | Regenerates docs/PERMISSION_MATRIX.md.                                                     | `scripts/generate-permission-matrix.mjs`        |
| `node scripts/generate-supply-chain.mjs`               | -                                                                                          | `scripts/generate-supply-chain.mjs`             |
| `node scripts/generate-surface-inventory.mjs`          | -                                                                                          | `scripts/generate-surface-inventory.mjs`        |
| `node scripts/generate-tools-doc.mjs`                  | Regenerates docs/TOOLS.md.                                                                 | `scripts/generate-tools-doc.mjs`                |
| `node scripts/idle-run-translations.mjs`               | Shown when a run's stream stays connected but no real event arrives for the whole idle...  | `scripts/idle-run-translations.mjs`             |
| `node scripts/install-git-hooks.mjs`                   | -                                                                                          | `scripts/install-git-hooks.mjs`                 |
| `node scripts/integration-translations.mjs`            | Cloud routines, GitHub/GitLab review comments and the Slack sink (F099, F101).             | `scripts/integration-translations.mjs`          |
| `node scripts/live-agent-check.mjs`                    | -                                                                                          | `scripts/live-agent-check.mjs`                  |
| `node scripts/live-agent-session.constants.mjs`        | -                                                                                          | `scripts/live-agent-session.constants.mjs`      |
| `node scripts/live-agent-session.mjs`                  | -                                                                                          | `scripts/live-agent-session.mjs`                |
| `node scripts/live-goal-stages.mjs`                    | -                                                                                          | `scripts/live-goal-stages.mjs`                  |
| `node scripts/live-rounds.mjs`                         | -                                                                                          | `scripts/live-rounds.mjs`                       |
| `node scripts/live-rounds.scenarios.mjs`               | -                                                                                          | `scripts/live-rounds.scenarios.mjs`             |
| `node scripts/load-knowledge-translations.mjs`         | The description of `clawAI.loadKnowledge`: the setting that puts a summary of              | `scripts/load-knowledge-translations.mjs`       |
| `node scripts/model-cost-translations.mjs`             | Model-picker cost bands and availability hint, the cache-write figure, the plan and        | `scripts/model-cost-translations.mjs`           |
| `node scripts/model-fallback-translations.mjs`         | Model fallback: the clawAI.fallbackModels setting and the panel notice shown               | `scripts/model-fallback-translations.mjs`       |
| `node scripts/nls-gap-translations.mjs`                | Manifest (package.nls) strings that shipped in English in every locale.                    | `scripts/nls-gap-translations.mjs`              |
| `node scripts/opt-in-tool-translations.mjs`            | Opt-in tools (HTTP and shell): the approval card lines and the three settings descripti... | `scripts/opt-in-tool-translations.mjs`          |
| `node scripts/package-audit.mjs`                       | -                                                                                          | `scripts/package-audit.mjs`                     |
| `node scripts/package-extension.mjs`                   | -                                                                                          | `scripts/package-extension.mjs`                 |
| `node scripts/pairing-retention-translations.mjs`      | F097 pairing QR panel and F055 zero-retention hardening (compare refusal, Show Usage).     | `scripts/pairing-retention-translations.mjs`    |
| `node scripts/parity-composer-translations.mjs`        | -                                                                                          | `scripts/parity-composer-translations.mjs`      |
| `node scripts/permission-mode-translations.mjs`        | F046 permission modes: ENTERPRISE_LOCKED is shown as "Strict" — a user's own               | `scripts/permission-mode-translations.mjs`      |
| `node scripts/plugin-approval-translations.mjs`        | Secure-by-default plugins: workspace plugins wait for approval, and a hook                 | `scripts/plugin-approval-translations.mjs`      |
| `node scripts/plugin-network-translations.mjs`         | Private-network plugin sources and untrusted webhook alerts.                               | `scripts/plugin-network-translations.mjs`       |
| `node scripts/plugin-signature-translations.mjs`       | F081 — publisher signatures on marketplace plugins.                                        | `scripts/plugin-signature-translations.mjs`     |
| `node scripts/plugin-tree-translations.mjs`            | F080/F081 — the Plugins view, git marketplaces and the organization                        | `scripts/plugin-tree-translations.mjs`          |
| `node scripts/pull-request-translations.mjs`           | -                                                                                          | `scripts/pull-request-translations.mjs`         |
| `node scripts/remote-channel-translations.mjs`         | F029 RemoteTrigger and F083 Channels: runtime messages and command titles.                 | `scripts/remote-channel-translations.mjs`       |
| `node scripts/remote-control-translations.mjs`         | F096 remote control, F097 phone pairing, F100 self-hosted runner.                          | `scripts/remote-control-translations.mjs`       |
| `node scripts/remote-session-translations.mjs`         | F094/F095/F098 — resuming conversations from other surfaces and cloud                      | `scripts/remote-session-translations.mjs`       |
| `node scripts/retry-once.mjs`                          | One bounded retry for a lane that is known to flake on the hosted runner.                  | `scripts/retry-once.mjs`                        |
| `node scripts/run-extension-tests.mjs`                 | -                                                                                          | `scripts/run-extension-tests.mjs`               |
| `node scripts/run-installed-extension-tests.mjs`       | -                                                                                          | `scripts/run-installed-extension-tests.mjs`     |
| `node scripts/runner-handoff-translations.mjs`         | F095/F098 — attaching to runner sessions, stopping them, and handing a                     | `scripts/runner-handoff-translations.mjs`       |
| `node scripts/runner-queue-translations.mjs`           | Runner policy verdict on the runner row (ADR-142), the runner-offline line when            | `scripts/runner-queue-translations.mjs`         |
| `node scripts/runner-routine-translations.mjs`         | F099 prompt routines and F100 runner approval policy.                                      | `scripts/runner-routine-translations.mjs`       |
| `node scripts/runner-workspace-fit-translations.mjs`   | F095: reconciling a runner session with the folders open in this window.                   | `scripts/runner-workspace-fit-translations.mjs` |
| `node scripts/scan-absolute-paths.mjs`                 | A test that reads a developer's temporary directory proves nothing in a fresh              | `scripts/scan-absolute-paths.mjs`               |
| `node scripts/security-telemetry-translations.mjs`     | Translations for the built-in /security-review description (F106) and the                  | `scripts/security-telemetry-translations.mjs`   |
| `node scripts/serve-webview-fixture.mjs`               | -                                                                                          | `scripts/serve-webview-fixture.mjs`             |
| `node scripts/ship-lib.mjs`                            | Pure helpers behind `npm run ship` / `npm run preflight`. No I/O here, so every            | `scripts/ship-lib.mjs`                          |
| `node scripts/ship.mjs`                                | The only sanctioned way to put code on main:                                               | `scripts/ship.mjs`                              |
| `node scripts/sign-plugin-catalog.mjs`                 | Signs every plugin entry of a marketplace catalog with an Ed25519 private key.             | `scripts/sign-plugin-catalog.mjs`               |
| `node scripts/tool-catalog-size.mjs`                   | Prints how many characters (and roughly how many tokens) each tool definition              | `scripts/tool-catalog-size.mjs`                 |
| `node scripts/usage-breakdown-translations.mjs`        | F107/F108 — the server-side sections of the usage dialog.                                  | `scripts/usage-breakdown-translations.mjs`      |
| `node scripts/verify-version-bump.mjs`                 | -                                                                                          | `scripts/verify-version-bump.mjs`               |
| `python skills/akinator/scripts/akinator_context.py`   | The cheapest way to gain context - a ranked reading list under a token budget.             | `skills/akinator/scripts/akinator_context.py`   |
| `python skills/akinator/scripts/akinator_coverage.py`  | Akinator coverage checker - the mechanically verifiable knowledge invariants.              | `skills/akinator/scripts/akinator_coverage.py`  |
| `python skills/akinator/scripts/akinator_distil.py`    | Distil - turn what recurs into a rule proposal.                                            | `skills/akinator/scripts/akinator_distil.py`    |
| `python skills/akinator/scripts/akinator_ledger.py`    | The Akinator ledger - what happened, so the next session does not rediscover it.           | `skills/akinator/scripts/akinator_ledger.py`    |
| `python skills/akinator/scripts/akinator_rules.py`     | Harden - rule evolution and conflict detection.                                            | `skills/akinator/scripts/akinator_rules.py`     |
| `python skills/akinator/scripts/akinator_scope.py`     | Scope a pass to what actually changed, and budget the questions.                           | `skills/akinator/scripts/akinator_scope.py`     |
| `python skills/akinator/scripts/akinator_sensitive.py` | Sensitive data: know what must not be exposed, document it, never leak it.                 | `skills/akinator/scripts/akinator_sensitive.py` |
| `python skills/akinator/scripts/akinator_trace.py`     | Every changed path is traced - no change lands without its knowledge.                      | `skills/akinator/scripts/akinator_trace.py`     |
| `python skills/akinator/scripts/akinator_version.py`   | Version discipline: every shipped change bumps the version, everywhere at once.            | `skills/akinator/scripts/akinator_version.py`   |
| `python skills/akinator/scripts/akinator_wiki.py`      | The living wiki - the repository as its own Confluence.                                    | `skills/akinator/scripts/akinator_wiki.py`      |
| `python skills/akinator/scripts/build_brief.py`        | Compose the context brief - what a new session actually reads.                             | `skills/akinator/scripts/build_brief.py`        |
| `python skills/akinator/scripts/extract_history.py`    | Generate the history wiki page from the records the repository already keeps.              | `skills/akinator/scripts/extract_history.py`    |
| `python skills/akinator/scripts/extract_libraries.py`  | Generate the library wiki - one page per declared dependency.                              | `skills/akinator/scripts/extract_libraries.py`  |
| `python skills/akinator/scripts/extract_operations.py` | Generate the operations wiki - the runnable surface of a repository.                       | `skills/akinator/scripts/extract_operations.py` |
| `python skills/akinator/scripts/extract_platform.py`   | Generate the platform wiki pages from what the tree actually contains.                     | `skills/akinator/scripts/extract_platform.py`   |
| `python skills/akinator/scripts/extract_stack.py`      | Generate the stack map - dependencies and modules, extracted from the tree.                | `skills/akinator/scripts/extract_stack.py`      |

### Required CLI tools

| Tool       | Implied by                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint`   | `package.json`                                                                                                                                       |
| `gh`       | `.github`                                                                                                                                            |
| `git`      | `.git`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` +1 more                                                                          |
| `node`     | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json` +58 more                                                                 |
| `npm`      | `.github/workflows/ci.yml`, `package.json`                                                                                                           |
| `prettier` | `package.json`                                                                                                                                       |
| `python`   | `skills/akinator/scripts/akinator_context.py`, `skills/akinator/scripts/akinator_coverage.py`, `skills/akinator/scripts/akinator_distil.py` +13 more |
| `tsc`      | `package.json`                                                                                                                                       |

Regenerate with: `python skills/akinator/scripts/extract_operations.py --write`
<!-- akinator:generated:end -->

## Notes on tools and commands

_Unknown - ask the owner and record the answer._
