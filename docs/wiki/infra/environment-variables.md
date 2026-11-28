# Environment variables

<!-- akinator:generated:begin -->
<!-- Facts extracted from the tree. This block is rewritten on every run;
     write outside it. -->

Names only - a value is never recorded here, even when an example file holds one.

| Variable                   | Declared in                     | Used in                                                                                                                | Has default? | Looks secret? |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------ | ------------- |
| `CI`                       | not declared                    | `scripts/install-git-hooks.mjs`, `tests/unit/runner-job-secrets.test.ts`                                               | yes          | no            |
| `CLAWAI_MONGODB_COMMAND`   | not declared                    | `src/services/database-workbench-service.ts`                                                                           | unknown      | no            |
| `CLAWAI_MONGODB_DATABASE`  | not declared                    | `src/services/database-workbench-service.ts`                                                                           | unknown      | no            |
| `CLAWAI_MONGODB_URI`       | not declared                    | `src/services/database-workbench-service.ts`                                                                           | unknown      | no            |
| `CLAW_FIXTURE_PORT`        | not declared                    | `scripts/capture-screenshots.mjs`, `scripts/serve-webview-fixture.mjs`                                                 | yes          | no            |
| `CLAW_LIVE_BACKEND_URL`    | not declared                    | `tests/live/live-api.helpers.ts`                                                                                       | yes          | no            |
| `CLAW_LIVE_EMAIL`          | not declared                    | `tests/live/live-api.helpers.ts`                                                                                       | yes          | no            |
| `CLAW_LIVE_MODEL`          | not declared                    | `tests/live/live-api.helpers.ts`                                                                                       | yes          | no            |
| `CLAW_LIVE_PASSWORD`       | not declared                    | `tests/live/live-api.helpers.ts`                                                                                       | yes          | yes           |
| `CLAW_LIVE_PROVIDER`       | not declared                    | `tests/live/live-api.helpers.ts`                                                                                       | yes          | no            |
| `CLAW_REAL_BROWSER`        | not declared                    | `tests/integration/playwright-browser-driver-real.test.ts`                                                             | unknown      | no            |
| `CLAW_STATE_DIR`           | not declared                    | `tests/unit/dogfood-fixes.test.ts`, `tests/unit/done-checks-cli.test.ts`, `tests/unit/done-checks-run.test.ts` +5 more | unknown      | no            |
| `CLAW_TOKEN`               | not declared                    | `tests/unit/done-checks-runner.test.ts`                                                                                | unknown      | yes           |
| `DEPLOY_KEY`               | not declared                    | `tests/unit/runner-job-secrets.test.ts`                                                                                | yes          | yes           |
| `FOO`                      | not declared                    | `tests/unit/shell-tool.test.ts`                                                                                        | unknown      | no            |
| `GH_TOKEN`                 | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | yes           |
| `GITHUB_BASE_REF`          | not declared                    | `scripts/verify-version-bump.mjs`                                                                                      | unknown      | no            |
| `GITHUB_EVENT_NAME`        | not declared                    | `scripts/verify-version-bump.mjs`                                                                                      | unknown      | no            |
| `HOME`                     | not declared                    | `tests/unit/shell-screen.test.ts`                                                                                      | unknown      | no            |
| `LOCALAPPDATA`             | not declared                    | `src/infrastructure/vscode-runtime-target-adapter.ts`                                                                  | yes          | no            |
| `NODE_ENV`                 | not declared                    | `tests/unit/shell-screen.test.ts`                                                                                      | unknown      | no            |
| `OVSX_PAT`                 | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | no            |
| `PATH`                     | not declared                    | `src/infrastructure/vscode-runtime-target-adapter.ts`                                                                  | yes          | no            |
| `PLAYWRIGHT_BROWSERS_PATH` | not declared                    | `src/infrastructure/vscode-runtime-target-adapter.ts`                                                                  | unknown      | no            |
| `PR_PROBE`                 | not declared                    | `tests/unit/sdk-pr-tool.test.ts`                                                                                       | yes          | no            |
| `Path`                     | not declared                    | `src/infrastructure/vscode-runtime-target-adapter.ts`                                                                  | yes          | no            |
| `RELEASE_BASE`             | `.github/workflows/ci.yml`      | not referenced in code                                                                                                 | unknown      | no            |
| `SOURCE_SHA`               | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | no            |
| `TAG`                      | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | no            |
| `UPDATE_PERMISSION_MATRIX` | not declared                    | `tests/unit/permission-matrix.test.ts`                                                                                 | unknown      | no            |
| `UPDATE_TOOLS_DOC`         | not declared                    | `tests/unit/tools-doc.test.ts`                                                                                         | unknown      | no            |
| `VERSION`                  | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | no            |
| `VSCE_PAT`                 | `.github/workflows/release.yml` | not referenced in code                                                                                                 | unknown      | no            |

Regenerate with: `python skills/akinator/scripts/extract_operations.py --write`
<!-- akinator:generated:end -->

## What each variable means and who owns its value

_Unknown - ask the owner and record the answer._
