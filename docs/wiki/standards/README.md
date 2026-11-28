# Standards

<!-- akinator:generated:begin -->
<!-- Facts detected from the tree. This block is rewritten on every run;
     write outside it. Nothing here is guessed: every row names its file. -->

### Languages

| Detected                | Where                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript (1961 files) | `playwright.config.ts`, `playwright.vscode.config.ts`, `src/backend/agent-remote-client.ts` (+1958 more)                                               |
| JavaScript (84 files)   | `esbuild.mjs`, `eslint.config.mjs`, `media/chat.js` (+81 more)                                                                                         |
| Python (16 files)       | `skills/akinator/scripts/akinator_context.py`, `skills/akinator/scripts/akinator_coverage.py`, `skills/akinator/scripts/akinator_distil.py` (+13 more) |

### Linters, formatters and type checkers

| Detected   | Where                                      |
| ---------- | ------------------------------------------ |
| ESLint     | `eslint.config.mjs`, `package.json`        |
| Prettier   | `.prettierrc.json`, `package.json`         |
| tsconfig   | `tsconfig.json`, `tsconfig.sdk-types.json` |
| TypeScript | `package.json`                             |

### Pre-commit and git hooks

| Detected                  | Where                  |
| ------------------------- | ---------------------- |
| Versioned hooks directory | `.githooks/pre-commit` |

### Test frameworks

| Detected          | Where                  |
| ----------------- | ---------------------- |
| Playwright        | `package.json`         |
| Playwright config | `playwright.config.ts` |
| Vitest            | `package.json`         |
| Vitest config     | `vitest.config.ts`     |

### CI

| Detected                 | Where                                                       |
| ------------------------ | ----------------------------------------------------------- |
| GitHub Actions workflows | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |

### Ownership

Nothing detected.

### Import conventions

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_platform.py --write`
<!-- akinator:generated:end -->

What this answers: languages, code standards, lint, hooks, imports, QA gates.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

## Which code standards, lint rules, hooks, import rules and QA gates apply, and which are enforced by a tool?

The policy lives in three files. [CLAUDE.md](../../../CLAUDE.md) holds the layers, the never-list and the known traps. [docs/RULES.md](../../RULES.md) holds the numbered rules, and each rule names where it is enforced. [AGENTS.md](../../../AGENTS.md) is the router. Most code rules are enforced by a tool and fail the gate. The rest are convention, checked in review. The table below says which is which. Facts below were read from the tree on 2026-11-28 (extension version 1.116.0).

## The standards and how each is enforced

| Standard                                                                                                                                                                                                 | Enforced by                                                                                                                                                     | Where                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No `any`, no `!` non-null assertion, no `console.*`, type-only imports use `import type`                                                                                                                 | ESLint, `--max-warnings=0` (`npm run lint`)                                                                                                                     | [eslint.config.mjs](../../../eslint.config.mjs); [CLAUDE.md](../../../CLAUDE.md) "Never"; [RULES](../../RULES.md) rule 7         |
| No `eslint-disable`, no `@ts-ignore`                                                                                                                                                                     | Review. The config names no rule for it. A search of `src/` found none                                                                                          | [RULES](../../RULES.md) rule 7                                                                                                   |
| Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`                                  | `npm run typecheck` (`tsc --noEmit`)                                                                                                                            | [tsconfig.json](../../../tsconfig.json); [RULES](../../RULES.md) rule 8                                                          |
| `strictTypeChecked` and `stylisticTypeChecked` typescript-eslint presets                                                                                                                                 | `npm run lint`                                                                                                                                                  | [eslint.config.mjs](../../../eslint.config.mjs)                                                                                  |
| Unused arguments start with `_`                                                                                                                                                                          | ESLint `no-unused-vars`                                                                                                                                         | [eslint.config.mjs](../../../eslint.config.mjs)                                                                                  |
| Files of at most 500 lines (blank lines and comments skipped); complexity at most 12                                                                                                                     | ESLint `max-lines`, `complexity`                                                                                                                                | [eslint.config.mjs](../../../eslint.config.mjs)                                                                                  |
| Import order is alphabetised in groups; no import cycles                                                                                                                                                 | ESLint `import/order`, `import/no-cycle` (eslint-plugin-import-x)                                                                                               | [eslint.config.mjs](../../../eslint.config.mjs); [library page](../libraries/eslint-plugin-import-x.md)                          |
| Formatting: single quotes, trailing commas, 100 columns, LF line endings                                                                                                                                 | `npm run format:check` (Prettier)                                                                                                                               | [.prettierrc.json](../../../.prettierrc.json); `.gitattributes` sets `eol=lf`                                                    |
| Types, interfaces, enums and module constants live in `*.types.ts` and `*.constants.ts`, not in logic files                                                                                              | Convention, reviewed                                                                                                                                            | [RULES](../../RULES.md) rule 8; [CLAUDE.md](../../../CLAUDE.md)                                                                  |
| Layers: imports point down only; `src/core` is pure (no `vscode`); `vscode` is wrapped only in `src/infrastructure`; only `src/backend` does HTTP; settings are read only through `ConfigurationService` | `import/no-cycle` plus review. No ESLint boundary rule exists. A search found no `vscode` import under `src/core`                                               | [CLAUDE.md](../../../CLAUDE.md) "Layers"; [RULES](../../RULES.md) rule 9; [ARCHITECTURE](../../ARCHITECTURE.md)                  |
| Backend responses and webview messages are validated (zod); webview has strict CSP, a fresh nonce, no `innerHTML` for model or backend data                                                              | Tests, plus `npm run package:audit` (asserts a nonce from `randomBytes` and no `.innerHTML =` in the webview script)                                            | [scripts/package-audit.mjs](../../../scripts/package-audit.mjs); [RULES](../../RULES.md) rule 16                                 |
| Coverage of at least 85% for branches, functions, lines and statements over a declared list of files                                                                                                     | `npm test` (`vitest run --coverage`) thresholds. The list holds 91 `src/` files                                                                                 | [vitest.config.ts](../../../vitest.config.ts); [RULES](../../RULES.md) rule 10                                                   |
| Every named critical file (19) and everything under `src/core/runtime/` is inside that list                                                                                                              | `npm run coverage:scope`. It reads git-tracked files only                                                                                                       | [scripts/labs/verify-coverage-scope.mjs](../../../scripts/labs/verify-coverage-scope.mjs)                                        |
| Every user-facing string goes through `vscode.l10n.t` or `package.nls.json`, translated for 12 locales                                                                                                   | `npm run l10n:verify` (regenerates, then `git diff --exit-code`); `tests/unit/localization-coverage.test.ts`; `l10n/untranslated-baseline.json` may only shrink | [RULES](../../RULES.md) rule 11; [CLAUDE.md](../../../CLAUDE.md)                                                                 |
| No machine-local absolute paths; no raw control bytes in source                                                                                                                                          | `npm run scan:paths`; `tests/unit/source-control-bytes.test.ts`                                                                                                 | [RULES](../../RULES.md) rule 12                                                                                                  |
| Every command, setting, view, keybinding and tool has an inventory row with a call path                                                                                                                  | `npm run inventory:verify`                                                                                                                                      | [docs/parity/SURFACE_INVENTORY.md](../../parity/SURFACE_INVENTORY.md); [RULES](../../RULES.md) rules 1 and 7                     |
| Package invariants: SemVer, lockfile and changelog agree, every contributed command is registered, all locale files exist, no VSIX at the repo root, no secret settings                                  | `npm run package:audit`                                                                                                                                         | [RULES](../../RULES.md) rule 13                                                                                                  |
| Generated docs stay fresh (tools doc, permission matrix)                                                                                                                                                 | `tests/unit/tools-doc.test.ts`, `permission-matrix.test.ts` fail until `npm run docs:tools` or `permissions:matrix` is rerun                                    | [CLAUDE.md](../../../CLAUDE.md) "Known traps"                                                                                    |
| Never log or store passwords, tokens, cookies, prompts or unredacted backend errors                                                                                                                      | `src/core/redaction.ts`; `tests/unit/redaction.test.ts`                                                                                                         | [RULES](../../RULES.md) rule 14 (security)                                                                                       |
| Never commit secret-shaped text, real or fake                                                                                                                                                            | gitleaks in pre-commit, pre-push and the Security scan workflow; `secretShapedAdditions` in `npm run ship`; GitHub secret scanning and push protection          | [RULES](../../RULES.md) rule 14a; `tests/helpers/fake-secrets.ts`                                                                |
| Runtime dependencies have no high advisory; all dependencies have no moderate advisory                                                                                                                   | `npm audit --omit=dev --audit-level=high` (CI audit job, ship gate); `npm audit --audit-level=moderate` (pre-push, Security scan) plus OSV-Scanner              | [.github/workflows/ci.yml](../../../.github/workflows/ci.yml); [security-scan.yml](../../../.github/workflows/security-scan.yml) |
| Every change gets a security and performance pass                                                                                                                                                        | `npm run security:check`, the skill, review                                                                                                                     | [RULES](../../RULES.md) rule 14b; [skill](../../../skills/secure-every-change/SKILL.md)                                          |
| Each main-bound change advances the delivery minor exactly once                                                                                                                                          | `.githooks/pre-commit`; CI "Version" job                                                                                                                        | [scripts/verify-version-bump.mjs](../../../scripts/verify-version-bump.mjs); [RULES](../../RULES.md) rules 5, 6, 14              |
| Nothing reaches `main` except through `npm run ship`; never `--no-verify`                                                                                                                                | The ship gate and hooks. GitHub branch protection (settings not recorded in the tree)                                                                           | [CLAUDE.md](../../../CLAUDE.md) "Never"; [ADR 0008](../../adr/0008-ship-gate-ci-parity.md)                                       |
| Docs, wiki, skills, rules, context and memory change in the same commit as the code                                                                                                                      | Review, plus two manual commands (see "Review" below)                                                                                                           | [RULES](../../RULES.md) rules 17 and 18                                                                                          |

## How the gates group these

- `npm run check` runs `check:quality`, then `check:unit`, then `build`. `check:quality` is `format:check`, `l10n:verify`, `lint`, `typecheck`, `scan:paths`, `inventory:verify`, `package:audit`. `check:unit` is `coverage:scope` and `npm test`.
- GitHub runs the same groups as separate jobs. See [Infra](../infra/README.md) and [Tools and commands](../infra/tools-and-commands.md).
- Traps that fail real runs ([CLAUDE.md](../../../CLAUDE.md), [TESTING](../../TESTING.md)): stage a new file before `coverage:scope`; stage regenerated locale files before `l10n:verify`; a command counts for `package:audit` only if its id is in a file that calls `registerCommand`; adding a command, view, setting or tool changes count tests and the inventory.
- Test lanes and what each proves: [Testing](../testing/README.md).

## Commit and release conventions

- Every main-bound change is a delivery release. The version advances the second SemVer component once and resets the patch (`1.90.0` to `1.91.0`). Source, lockfile, changelog, README and the final VSIX must agree ([RULES](../../RULES.md) rules 5, 6, 14; skills [version-every-change](../../../skills/version-every-change/SKILL.md) and [land-a-release](../../../skills/land-a-release/SKILL.md)).
- The pre-commit hook does the bump (`scripts/ensure-release-version.mjs --stage`), then checks it against `origin/main`. CI checks it again. A published tag is never reused.
- The only way to put code on `main` is `npm run ship`. `npm run preflight` runs the same Linux gate without pushing ([ADR 0008](../../adr/0008-ship-gate-ci-parity.md)). Details: [Infra](../infra/README.md).
- A release needs a `## <version>` heading in [CHANGELOG.md](../../../CHANGELOG.md). User notes go there; engineering detail goes in [DETAILED_CHANGELOG](../../releases/DETAILED_CHANGELOG.md).
- A red gate is fixed before any other work. Each new failure class adds a row to [CI_FAILURES](../../CI_FAILURES.md).

Which format a commit message must follow:

_Unknown - ask the owner and record the answer._

## Review, and docs that move with code

- Rule 17: every change runs the Akinator pass ([skill](../../../skills/akinator/SKILL.md), [ADR 0009](../../adr/0009-akinator-runs-on-every-change.md)). A typo-only change records `knowledge delta: none, because <reason>`. Rule 18: every meaningful change records the business, product and technical why, before and after, date, requester, alternatives and the tests actually run. An unknown fact is written as the gap marker, never guessed.
- Enforcement named by the rules: `python -I skills/akinator/scripts/akinator_wiki.py check` and `akinator_coverage.py . --strict`, plus review. No workflow, hook or npm script in the tree calls either command, so they run by hand or by the agent.
- There is no `CODEOWNERS` file and no pull-request template. The generated block above reports no ownership.

Who reviews a change that `npm run ship` pushes straight to `main`:

_Unknown - ask the owner and record the answer._

## Security standards

- Rule 14 (security): no passwords, tokens, cookies, prompts or unredacted backend errors in logs or storage; no secret-bearing settings. See [Observability](../observability/README.md) for what is logged.
- Rule 14a: no secret-shaped text in the repository. Tests build fake secrets at run time. History was rewritten on 2026-11-28 after GitHub flagged a fake value ([incident](../../incidents/2026-11-28-fake-openai-key-flagged.md), [memory](../../../memory/README.md), [handle-a-secret-alert](../../../skills/handle-a-secret-alert/SKILL.md)).
- Rule 14b and [skills/secure-every-change](../../../skills/secure-every-change/SKILL.md): scan (`npm run security:check`), research the change's attack surface, write abuse tests first, run a penetration-style trial through the real entry point, measure hot paths before and after, patch the root cause, record. `security:check` runs npm audit over every dependency, gitleaks on the tree and a list of open GitHub alerts. A check that cannot run is reported as SKIPPED, never as passed.
- Rules 15 and 16: workspace content is untrusted; secrets are always denied; every modifying workflow stages a reviewable diff, rechecks Workspace Trust and applies one atomic edit; webviews follow the CSP rules above. Threat model: [docs/SECURITY.md](../../SECURITY.md); wiki: [Security](../security/README.md).

## Contradictions found while writing this page (to resolve)

| Found on 2026-11-28 | Documents                                                                                                           | Conflict                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage floor      | [TESTING](../../TESTING.md) says 80% for branches; `vitest.config.ts` and RULES rule 10 say 85%                     | The config is the enforced value. TESTING is stale                                                                                                                                                          |
| 95% floor           | TESTING says runtime security-critical modules need 95%; `vitest.config.ts` sets one global 85% and no per-file 95% | No tool in the tree enforces 95%                                                                                                                                                                            |
| Security lint       | [secure-every-change](../../../skills/secure-every-change/SKILL.md) lists `eslint-plugin-security` as a catch       | The config registers the plugin and turns two of its rules off. It does not extend a preset, so no `security/*` rule is on                                                                                  |
| Gitleaks allowlist  | RULES 14a says "no allowlist"                                                                                       | `.gitleaks.toml` has one entry, for request idempotency keys                                                                                                                                                |
| Rule numbers        | RULES numbers rules 7 and 14 twice                                                                                  | [SURFACE_INVENTORY](../../parity/SURFACE_INVENTORY.md) cites "rule 6" for the inventory, which is the second rule 7. ADR 0008 and CI_FAILURES cite "rule 14" for the CI gate; SECURITY cites it for secrets |

Which of these the owner wants fixed first:

_Unknown - ask the owner and record the answer._

How a fresh worktree gets the git hooks. The `prepare` script sets `core.hooksPath` (`scripts/install-git-hooks.mjs`), and the documented setup `npm ci --ignore-scripts` skips `prepare`. No document says what to run after it:

_Unknown - ask the owner and record the answer._
