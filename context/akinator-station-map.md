# Akinator station map (ClawAI Coding Agent)

Where each Akinator station writes in this repository. Procedure:
[`skills/akinator/SKILL.md`](../skills/akinator/SKILL.md). Rule: `docs/RULES.md` rule 17.
Decision: [`docs/adr/0009-akinator-runs-on-every-change.md`](../docs/adr/0009-akinator-runs-on-every-change.md).
Review this map whenever a home below is renamed or a new knowledge folder appears.

| Station        | Asks                                                 | Output lands in                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ASK         | What is ambiguous, and what does a wrong guess cost? | The response: one grouped, ranked, defaulted battery. Answers go into their homes at once.                                                                                                                                            |
| 2. RESOLVE     | What does the layer already answer?                  | Read: `AGENTS.md`, `CLAUDE.md`, `docs/RULES.md`, `context/*`, `memory/*`, `.ai/BRIEF.md`, `docs/wiki/index.md`                                                                                                                        |
| 3. AUDIT       | Done, partial, present-but-not-wired, or missing?    | The plan or report; large audits in `docs/parity/`                                                                                                                                                                                    |
| 4. PLAN        | Batches, blast radius, knowledge delta by path       | The response; multi-step work in `docs/plans/<date>-<slug>.md`                                                                                                                                                                        |
| 5. IMPLEMENT   | -                                                    | `src/` by layer (`CLAUDE.md`), tests in `tests/`                                                                                                                                                                                      |
| 6. DOCUMENT    | What is now true?                                    | The nearest `docs/*.md` (`ARCHITECTURE`, `API_CONTRACTS`, `HEADLESS`, `SECURITY`, `TESTING`, `PERMISSION_MATRIX`...), the feature page in `docs/wiki/features/`, `CHANGELOG.md`. `docs/TOOLS.md` is generated (`npm run docs:tools`). |
| 7. SKILLIFY    | Is this repeatable?                                  | `skills/<name>/SKILL.md` and the skill list in `CLAUDE.md` and `AGENTS.md`                                                                                                                                                            |
| 8. RULE        | Is this a new constraint?                            | A numbered entry in `docs/RULES.md` with its "Enforced by:" mechanism                                                                                                                                                                 |
| 9. CONTEXTIFY  | Did structure change?                                | `context/*.md` (module map, this map)                                                                                                                                                                                                 |
| 10. MEMOIZE    | What must the next session remember?                 | `memory/*.md`, indexed from `memory/README.md`                                                                                                                                                                                        |
| 11. INDEX+SYNC | Reachable? Routers agree?                            | `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `GEMINI.md`, `.cursor/rules/akinator.mdc`, `.github/copilot-instructions.md`, `docs/wiki/index.md` (`akinator_wiki.py index`)                                                                   |
| 12. VERIFY     | Do the gates and the knowledge checks pass?          | The response: real commands and exit codes (`npm run check`, `akinator_coverage.py . --strict`, `akinator_trace.py check`, `akinator_sensitive.py scan`, `akinator_wiki.py check`)                                                    |
| every. WIKI    | Where does this land for a human reader?             | `docs/wiki/<category>/`, mirrored to the GitHub wiki by `.github/workflows/publish-wiki.yml`                                                                                                                                          |

Decisions: `docs/adr/NNNN-<slug>.md` (index `docs/adr/README.md`). Failures, answered
questions and surprises: the ledger (`python -I skills/akinator/scripts/akinator_ledger.py add ...`,
stored in `.ai/ledger/`). Release notes: `CHANGELOG.md` (the release flow cuts versions).

Review when: a station home is renamed, a knowledge folder is added or removed, or `docs/RULES.md` rules 17-18 change. Last verified: 2026-11-28.
