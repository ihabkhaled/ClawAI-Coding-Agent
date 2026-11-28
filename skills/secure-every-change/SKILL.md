---
name: secure-every-change
description: The security and performance pass every change, patch and feature goes through before it is called done - dependency, code and secret scanning, vulnerability research, threat and abuse cases, penetration-style tests, stress and performance checks, and patching what they find. Use on every change in this repository, without being asked.
---

# Secure every change

Security is checked on every change, not at release time. The owner's standard
(2026-11-28): very high security and performance, every scenario covered, no red
scanner left open. This skill is the procedure; `docs/RULES.md` rule 14b makes it
mandatory; `npm run security:check` runs the automatic part.

## When to use

- Every change: a feature, fix, refactor, dependency bump, workflow or docs change
  that touches commands, network, files, auth, tools, the webview or the release.
- Whenever GitHub shows a code-scanning, Dependabot or secret-scanning alert, or a
  Security scan / CI security job is red.
- Before every `npm run ship`.

## When NOT to use

- A typo or formatting-only change in prose: run `npm run security:check` once and
  record `security delta: none, because <reason>`.
- As a substitute for the release gates: `npm run ship` still runs everything.

## Procedure

1. **Scan.** `npm run security:check` - npm audit over every dependency (moderate and
   above), gitleaks on the working tree, and the open GitHub code-scanning,
   Dependabot and secret-scanning alerts. Every FAIL is fixed in this change; a
   SKIPPED line is reported as skipped, never as passed.
2. **Research the change's attack surface.** List what the change touches (input,
   workspace content, model output, network, shell, files, secrets, webview, IPC,
   backend contract, release). For each, look up current advisories for the
   libraries involved (GitHub Advisory Database, OSV, the library's changelog) and
   the OWASP LLM / agentic / API risks that apply. Write the threats in the PR or
   the change record.
3. **Write the abuse tests first.** For each threat, a test that tries it: prompt
   injection in tool output and files (including hidden markup, zero-width and bidi
   characters, encoded text), path traversal and symlinks, command and argument
   injection, SSRF and private addresses, oversized and malformed input, ReDoS,
   replay and duplicates, secret leakage into logs, prompts, receipts and errors.
   Fake secrets come from `tests/helpers/fake-secrets.ts` only (rule 14a).
4. **Penetration-style trial.** Run the feature the way an attacker would, through
   its real entry point (headless CLI, the panel, the SDK), with the hostile inputs
   from step 3. Any unauthorised side effect is a blocking failure, even when the UI
   says it was refused.
5. **Stress and performance.** For anything on a hot path (streaming, tool calls,
   context assembly, file reads, the webview), measure before and after: latency,
   memory, output size, number of calls. Bounded loops, bounded buffers, timeouts on
   every external call. Record the numbers.
6. **Patch and recheck.** Fix the root cause (never weaken a test, a rule or a
   scanner; never allowlist a real finding), rerun steps 1, 3 and 4.
7. **Record.** CHANGELOG entry and the feature page in `docs/wiki/features/` say what
   was tested, with real commands and results. A false positive is dismissed on
   GitHub with its reason, and the reason is written down.

## Tools in this repository

| Tool                                             | Where                                                                                     | What it catches                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run security:check`                         | local, any time                                                                           | dependency advisories, local secrets, open GitHub alerts |
| gitleaks 8.24.3                                  | pre-commit (staged), pre-push (outgoing), Security scan workflow (pushes, weekly history) | secrets                                                  |
| npm audit, all dependencies                      | pre-push, Security scan workflow                                                          | vulnerable packages, development tools included          |
| OSV-Scanner 2.7.1                                | Security scan workflow                                                                    | vulnerabilities from the OSV database                    |
| CodeQL (default setup)                           | GitHub, every push                                                                        | code vulnerabilities (injection, ReDoS, workflows)       |
| Dependabot alerts and security updates           | GitHub                                                                                    | vulnerable dependencies, update PRs                      |
| eslint-plugin-security, typescript-eslint strict | `npm run lint`                                                                            | unsafe code patterns                                     |
| Secret scanning and push protection              | GitHub                                                                                    | secrets at push time                                     |

## Failure modes

- Calling a SKIPPED scanner a pass, or a mocked test live evidence.
- Dismissing an alert without a written reason, or allowlisting to get green.
- Testing only the happy path: every input boundary needs a hostile case.
- Fixing the symptom a scanner names instead of the root cause.
- Upgrading a linter together with feature code: it hides real findings in noise.

## Definition of done

- [ ] `npm run security:check` exits 0, or every FAIL is fixed and every SKIPPED is named.
- [ ] Threats for the change are written down and each has a test that tries it.
- [ ] The penetration-style trial ran through the real entry point; results recorded.
- [ ] Hot paths measured before and after; nothing unbounded.
- [ ] GitHub shows no open code-scanning, Dependabot or secret-scanning alert.
- [ ] CHANGELOG and the feature page record what was tested and how.

Related: `skills/handle-a-secret-alert/SKILL.md`, `docs/SECURITY.md`,
`docs/THREAT_MODEL_RUNTIME_V2.md`, `memory/README.md`.
