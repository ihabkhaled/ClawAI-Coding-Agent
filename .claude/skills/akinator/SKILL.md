---
name: akinator
description: Use for EVERY prompt in this repository that can change it - a feature, fix, refactor, upgrade, deletion, migration, config, docs, test, audit, release, or any request to add, change, remove, build, implement, update or improve something. Runs the full Akinator pass (ask, resolve, audit, plan, implement, document, skillify, rule, contextify, memoize, index and sync, verify) with no command typed. docs/RULES.md rule 17.
---

# Akinator (ClawAI Coding Agent project skill)

This is the auto-loading pointer. The procedure lives in the repository, not here.

1. Read [`skills/akinator/SKILL.md`](../../../skills/akinator/SKILL.md) and follow it. Nobody has to type a command;
   forgetting the plugin or the slash command is never a reason to skip the pass (`docs/RULES.md` rule 17).
2. Start with `python -I skills/akinator/scripts/akinator_context.py pack --for "<task>"`, then declare the knowledge
   delta by path, or write `knowledge delta: none, because <reason>` for a typo or formatting-only change.
3. Documentation, the wiki (`docs/wiki/`), skills, rules, context and memory land in the same commit as the code.
