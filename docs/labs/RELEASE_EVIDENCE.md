# Wave 1 Release Evidence

Evidence captured on 2026-08-26 in the main worktree on Windows x64. This is
candidate evidence, not proof of publication or production deployment.

## Automated gates

| Probe                              | Result                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `npm run package:audit`            | PASS: 23 commands, 13 locales, strict CSP, no secret settings |
| `npm run check`                    | PASS: 170 files, 1,158 tests, build and package audit         |
| Critical coverage scope            | PASS: 43 required files, none missing                         |
| Coverage                           | PASS: 94.16% statements, 88.16% branches, 95.88% functions    |
| VS Code extension host             | PASS: VS Code 1.135.0 activation and `openChat` exited 0      |
| Production dependency audit        | PASS: 0 vulnerabilities                                       |
| Runtime backend-client integration | PASS: 1 file, 5 tests                                         |
| Playwright snapshot refresh        | PASS: 45 tests; six expected Windows images regenerated       |
| Playwright unchanged replay        | PASS: 45 tests; no further snapshot changes                   |
| Recovery/security stress           | PASS: 20/20 cycles across four focused suites                 |

The runtime integration probe verifies authenticated requests for protocol
negotiation, run start, resumable SSE, result submission, steering, and cancel.
Checkpoint persistence is local extension state; the client does not call or
document a public checkpoint endpoint.

## Visual review

| Baseline                         | Verdict                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `signal-desk-parallel-win32.png` | PASS: both active runs and targeted cancel controls remain visible               |
| `signal-desk-compare-win32.png`  | PASS: comparison cards, model choices, and composer controls remain legible      |
| `signal-desk-narrow-win32.png`   | PASS: 320px settings and composer remain contained without horizontal clipping   |
| `workbench-agent-run-win32.png`  | PASS: run status, changed-file receipt, and composer remain visible              |
| `workbench-narrow-win32.png`     | PASS: error state and primary controls remain usable at 320px                    |
| `workbench-light-win32.png`      | PASS: light-theme text, borders, controls, and focusable surfaces remain legible |

The refreshed images match the intentional compact status/run presentation and
composer focus treatment already present in source. Non-composer keyboard
controls retain visible boundaries. Forced-colors behavior also passes the
Playwright assertion.

## Remaining release evidence

The VSIX contains 126 files with no `.clawai-lab` or `.superpowers` content.
Operator and verifier profiles both install `clawai.clawai-coding-agent@0.64.4`;
each exact installed directory activates in VS Code 1.135.0 and passes the host
command/config assertions, including opening the real workbench command. Release
parity has no local failures and its wrong-installed-version negative control
detects the mismatch. Provenance binds the artifact to source commit
`e805c16ff22738a774a1fefada70601c306e3eec`.

| Artifact   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| VSIX       | `d775ace81ca0e3d54268882e205f71778b2c00cb65ee99cf4dec0761a353f9d0` |
| CycloneDX  | `812729fc666ea0d4904884f3512866e3f5c24194cd1fb5dc237f3763fbf830a6` |
| SPDX       | `193d244e2bedf6851e6ef75a6584a533e69395a7dcf680b4c63ffcd96044b824` |
| Provenance | `0b4774126310ffcdfa8eb5f8246b9e76830262fd72587143fdebc542483673c8` |

Mutation, large-scale, self-hosting, and live-provider lanes remain open and earn
no points. Public push, tag, GitHub release, Marketplace publication, and
production deployment remain approval gates.
