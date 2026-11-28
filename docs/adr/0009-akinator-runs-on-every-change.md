# ADR 0009: Akinator is vendored and runs on every change, with no command

- Status: accepted
- Date: 2026-11-28
- Asked by: the owner, 2026-11-28 ("run Akinator in the coding agent repository, so even if
  the plugin or the command is forgotten, everything Akinator says is done by default; document
  the old code too; run the GitHub wiki").
- Relates to: `docs/RULES.md` rules 17 and 18, `context/akinator-station-map.md`,
  `skills/akinator/SKILL.md`; the ClawAI monorepo made the same decision in its ADR-207.

## Context

This repository had good engineering docs (`docs/*.md`, eight ADRs, a parity audit, sixteen
skills) but no business or product "why" per feature, no history per feature, no requirements
register or drift log, no `context/` or `memory/`, and no wiki: the GitHub wiki did not exist.
The Akinator method was applied only when the owner's plugin was installed and invoked, so an
agent that forgot the command, or a different tool, skipped it and the owner had to repeat
the instruction.

## Decision

1. **Vendor Akinator 2.2.0** into `skills/akinator/`: `SKILL.md`, every station reference, the
   MIT license and **all sixteen tools**. Unlike the monorepo, this repository has no other
   generator for `.ai/` or a wiki, so the writers (`akinator_wiki`, `build_brief`,
   `extract_*`, `akinator_distil`, `akinator_rules`) are the generators here.
2. **Make it mandatory** with `docs/RULES.md` rule 17 (every change, every agent, every tool,
   no command) and rule 18 (every meaningful change records business, product and technical
   why, before and after, date, requester, alternatives, and tests run with results).
3. **Trigger it wherever a tool can be triggered**: `AGENTS.md`, `CLAUDE.md`, a new `CODEX.md`
   and `GEMINI.md`, `.cursor/rules/akinator.mdc`, `.github/copilot-instructions.md`, a Claude
   Code project skill in `.claude/skills/akinator/` and a `UserPromptSubmit` reminder in
   `.claude/settings.json`.
4. **The wiki lives in `docs/wiki/`** (Akinator's layout, 25 categories) and is mirrored to the
   GitHub wiki by a workflow; the GitHub wiki is never edited by hand. Category pages index the
   existing homes (`docs/*.md`, `docs/adr/`, `docs/parity/`) instead of copying them.
5. **Retro documentation**: one page per feature area in `docs/wiki/features/`, written from
   the code, `CHANGELOG.md`, git history and tests. Unknown facts carry the gap marker.
6. **Versions stay with the release flow**: `akinator_version.py` is read-only here.

## Alternatives considered

- **Link to the plugin instead of copying**: rejected; an agent without the plugin or network
  has nothing to read, and upstream edits would silently change behaviour.
- **Vendor only the read-only tools, as the monorepo did**: rejected for this repository; the
  monorepo has `knowledge:build`, this one has nothing else to write the wiki and brief.
- **Edit the GitHub wiki directly**: rejected; it drifts from the code and agents reading the
  repository never see it.
- **A note per source file**: rejected by the owner in favour of one page per feature area.
- **A git hook that runs the tools**: rejected; hooks stay fast and the method is a way of
  working no hook can check.

## Consequences

- About forty more Markdown files and sixteen Python files to maintain; upstream updates are
  re-vendored by hand and divergences are listed in `skills/akinator/SKILL.md`.
- The tools need Python 3.10+ on the developer machine; nothing in `npm run check`, the VSIX or
  CI depends on them (`skills/**`, `context/**`, `memory/**`, `.ai/**` are in `.vscodeignore`).
- Every change costs a knowledge pass; the trivial-change exception keeps it proportionate.
- Stale when: the method or its tools change upstream, or the wiki home moves.
