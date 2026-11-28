---
name: akinator
description: Use for every prompt in this repository - Akinator is always on and this is its only skill. For any intent that can change the repository (feature, fix, refactor, upgrade, deletion, migration, config, docs, test, audit, release), run the complete Akinator pass so code, product intent, business logic, decisions, history, skills, rules, context, memory, the wiki and verification evolve together in one change. Also the one explicit command. Loads its station references on demand.
---

<!--
Vendored in the ClawAI Coding Agent from the owner's Akinator plugin
(github.com/ihabkhaled/akinator-ai, version 2.2.0, MIT, copyright Ihab Khaled; the
license is kept in ./LICENSE). The in-repo copy is the source of truth for this
repository (docs/adr/0009). Edits are allowed here; every divergence from
upstream is listed under "Divergences from upstream".
-->

# Akinator

Ask everything. Document everything. Skillify everything. Rule everything.
A change is the code **plus** the knowledge that lets the next agent act on it
in seconds. Half a change is no change.

**Every prompt is documented.** Whatever a prompt changes or decides lands in
the living wiki (`docs/wiki/`, 25 categories: product, business, market,
requirements, drift, roadmap, architecture, data, services, libraries, stack,
standards, infra, observability, security, integrations, testing, UX, project,
risks, decisions, changes, history, glossary, onboarding) plus the README, every
router, rules, memory, context and the ledger - same batch. Every changed path
is traced, sensitive data is known by name and never exposed, and the agent owns
its reversible decisions. See [akinator-wiki](references/akinator-wiki.md).

**Be cheap.** Gain context with
`python -I skills/akinator/scripts/akinator_context.py pack --for "<task>"` (no
subprocess, cached under `.ai/cache/`), never by reading the tree.

**This is Akinator's only skill and its only command.** Normal prompts enter it
automatically. The explicit form is a fallback: `/akinator` in Claude Code (the
project pointer in `.claude/skills/akinator/`), `$akinator` on Codex, the
`akinator` rule in Cursor. Each station is a reference file inside this skill,
opened when the work reaches it - never a separate skill.

## When to use

- Every prompt in this repository. For pure conversation it only resolves context.
- Any intent that can change the repository, and whenever the user asks for
  "everything" or "the full pass".
- Before a release, handover or audit; on money, permissions, deletion, public
  contracts, the backend contract or the release pipeline.

## When NOT to use

- Pure conversation, or inside a narrow subagent whose parent owns the pass.
- As a substitute for thinking: it guarantees nothing is skipped, not that every
  judgment is right.

## In the ClawAI Coding Agent

- **Always on.** `docs/RULES.md` rule 17 makes this pass mandatory for every
  change, every agent and every tool. Nobody has to type a command; forgetting
  the plugin or the command is never a reason to skip it.
- **Where each station lands** in this repository:
  [`context/akinator-station-map.md`](../../context/akinator-station-map.md).
- **Run the tools from the repository root** with
  `python -I skills/akinator/scripts/<tool>.py` (Python 3.10+, standard library
  only). All sixteen upstream tools are vendored: this repository has no other
  generator for `.ai/` or `docs/wiki/`, so the writers (`akinator_wiki`,
  `build_brief`, `extract_*`, `akinator_distil`, `akinator_rules`) are the
  generators here.
- **Versions come from the release flow.** The pre-commit hook advances the
  delivery minor and CI verifies it (`skills/version-every-change/SKILL.md`).
  `akinator_version.py` is used read-only (`show`, `check`); never `bump` or `set`.
- **The GitHub wiki is a mirror.** `docs/wiki/` is the source; the
  `Publish wiki` workflow copies it to the repository's GitHub wiki on every
  push to `main`. Never edit the GitHub wiki by hand.
- **Never in a git hook, never in the VSIX.** The tools run on demand by the
  agent; `skills/**`, `docs/**`, `context/**`, `memory/**` and `.ai/**` are in
  `.vscodeignore`.

## The stations

| #     | Station                                          | Reference                                                                                                            |
| ----- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1     | ASK                                              | [akinator-intake](references/akinator-intake.md)                                                                     |
| 2     | RESOLVE                                          | [akinator](references/akinator.md) - creed, loop, taxonomy                                                           |
| 3     | AUDIT                                            | [akinator-audit](references/akinator-audit.md)                                                                       |
| 4     | PLAN                                             | [akinator-plan](references/akinator-plan.md)                                                                         |
| 5     | IMPLEMENT                                        | the repository's own conventions (`CLAUDE.md`, `docs/RULES.md`)                                                      |
| 6     | DOCUMENT                                         | [akinator-document-change](references/akinator-document-change.md)                                                   |
| 7     | SKILLIFY                                         | [akinator-skillify](references/akinator-skillify.md)                                                                 |
| 8     | RULE                                             | [akinator-rule-forge](references/akinator-rule-forge.md)                                                             |
| 9     | CONTEXTIFY                                       | [akinator-contextify](references/akinator-contextify.md)                                                             |
| 10    | MEMOIZE                                          | [akinator-memoize](references/akinator-memoize.md)                                                                   |
| 11    | INDEX+SYNC                                       | [akinator-index-sync](references/akinator-index-sync.md), [akinator-router-sync](references/akinator-router-sync.md) |
| 12    | VERIFY                                           | [akinator-gate-economy](references/akinator-gate-economy.md)                                                         |
| every | WIKI - document every prompt everywhere it lands | [akinator-wiki](references/akinator-wiki.md)                                                                         |

Open when the work touches their domain: deciding or recommending
[akinator-decide](references/akinator-decide.md) · decision records
[akinator-adr](references/akinator-adr.md) · money
[akinator-business-map](references/akinator-business-map.md) · user-facing
behavior [akinator-product-map](references/akinator-product-map.md) · operations
[akinator-ops-map](references/akinator-ops-map.md) · no knowledge layer yet
[akinator-onboard](references/akinator-onboard.md) · layer audit
[akinator-coverage](references/akinator-coverage.md) · a box about to be ticked
[akinator-anti-gaming](references/akinator-anti-gaming.md) · anything heavy
[akinator-resource-guard](references/akinator-resource-guard.md).

## Standing rules

- Stations 6-11 happen in the **same batch** as the code. "I'll document in a
  follow-up" is a prohibited sentence.
- Declare the knowledge delta **by path** at PLAN time, or say
  `knowledge delta: none, because <reason>`.
- Ask a lot: one grouped battery per prompt (up to 15, plus every wiki gap),
  ranked, each with a recommended default. Write every answer down at once.
- Honest gaps only: `_Unknown - ask the owner and record the answer._`, never
  an invented fact.
- Every meaningful change records **business why, product why, technical why**,
  before and after, the date, who asked, the alternatives, and the tests that
  were actually run with their results (the change record in
  [akinator-wiki](references/akinator-wiki.md) section 4).
- Adopt the repository's conventions; one canonical home per fact. The wiki
  indexes `docs/*.md`, `docs/adr/` and `docs/parity/`; it does not copy them.
- Never guess on money, permissions, deletion, security or public contracts.
- Never weaken a check to pass it. Never put knowledge checks in git hooks.
- Before writing text that quotes config or logs: `akinator_sensitive.py guard`.
  A repeat (`akinator_distil.py repeats`) is a question: skill, rule or neither.
- Gate once, late and scoped. Report evidence truthfully.

## Procedure

The complete pass, with every tool command, is in
[references/procedure.md](references/procedure.md). The outline:

1. **Establish the ground** - RESOLVE the layer and the ledger, adopt the
   conventions, ASK once in a group, AUDIT claim versus code, scope the pass.
2. **Plan** - `akinator_trace.py plan`, batches on real seams, knowledge delta by
   path, every relevant review lens (business, CTO, product, ops, analyst, PM)
   at plan time.
3. **Build batch by batch** - implement, then DOCUMENT, SKILLIFY, RULE,
   CONTEXTIFY, MEMOIZE, the ledger (requirements and drift too), decisions,
   the wiki (`python -I skills/akinator/scripts/akinator_wiki.py index`, library
   pages with `extract_libraries.py --write`), INDEX+SYNC; librarian review on
   every batch.
4. **Prove it** - gate once (`npm run check`, then `npm run ship`), run
   `akinator_coverage.py . --strict`, `akinator_trace.py check`,
   `akinator_sensitive.py scan` and `akinator_wiki.py check`, anti-gaming on
   your own output, regenerate the brief (`build_brief.py --write`).
5. **Loop until the Definition of Done is proven, then stop.**

Genuinely trivial work - a typo, a formatting-only change - is the one
exception: say so in one line, do it, record `knowledge delta: none, because ...`.

## Failure modes and pitfalls

- Ceremony on trivia - it gets the discipline abandoned.
- Ticking a phase with no artifact or exit code behind it.
- Skipping the librarian review on a "small" batch.
- Gate storms, and looping after the Definition of Done is proven.

## Definition of done

- [ ] The layer was read and cited; the repository's conventions were adopted.
- [ ] Every open question was asked, or the assumption is written down.
- [ ] Every batch declared its knowledge delta by path, and delivered it.
- [ ] Every artifact is true, reachable from an index, and in every router.
- [ ] Every new rule names a mechanism that exists and was run.
- [ ] The librarian review returned `CLEAR` on every batch.
- [ ] Gates ran once, scoped, with exit codes observed and reported.
- [ ] Anti-gaming was applied to this pass's own output.
- [ ] The machine was left as found; anything undone is named, with why.

## Divergences from upstream

- `<skill>` is written `skills/akinator`; references that the ClawAI monorepo
  copy pointed at `<upstream>/scripts/` point at the vendored tools here.
- Example paths in references are the monorepo's or invented illustrations; this
  repository's real homes are in `context/akinator-station-map.md`.
- `akinator_version.py` is read-only (versions come from the pre-commit hook).
- The plugin's `.claude-plugin`, hooks and agents are not vendored; the routers
  (`CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `GEMINI.md`, `.cursor/rules/akinator.mdc`,
  `.github/copilot-instructions.md`) and the project skill pointer carry the
  trigger instead.
