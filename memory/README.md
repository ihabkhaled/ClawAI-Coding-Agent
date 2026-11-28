# Engineering memory (ClawAI Coding Agent)

Dated lessons: what happened, why a rule exists, what to do next time. Rules say what must be done
(`docs/RULES.md`); skills say how (`skills/`); memory says why and what bit us. Newest first.

### A fake key in a test is an incident (2026-11-28)

**What happened.** GitHub secret scanning flagged `tests/unit/adv-vision.test.ts`'s fake OpenAI-shaped value as a
public leak. The alert sat open from 2026-10-02 to 2026-11-28. The owner ordered a full history rewrite.
**Lesson.** Never write a complete secret shape, even fake: build it at run time (`tests/helpers/fake-secrets.ts`).
**Next time.** `skills/handle-a-secret-alert/SKILL.md`; record: `docs/incidents/2026-11-28-fake-openai-key-flagged.md`.

### A history rewrite must leave today's tree identical (2026-11-28)

**What happened.** A dry run of `git filter-repo --replace-text` showed it would still change four current files
(short fakes that 1.115.0 missed). Pushing it would have weakened tests silently.
**Lesson.** Compare the HEAD tree before and after on a scratch clone; fix forward until equal, then rewrite.
**Also.** The Release workflow must be disabled during the force-push and until CI finishes (the tag exists); the
first CI run on the rewritten head fails its Version job for the same reason, and the next release turns it green.
GitHub keeps `refs/pull/*` of closed pull requests: only GitHub Support can purge them.

### What `npm run ship` catches that a Windows run does not (2026-11-28)

- `docs/parity/SURFACE_INVENTORY.md` cites test line numbers: any test edit can make it stale (`npm run inventory:surface`).
- A new dot-file at the root (`.gitleaks.toml`) is packaged into the VSIX unless `.vscodeignore` lists it.
- Untracked log files in the tree fail `package:audit` locally; keep logs outside the repository.
- eslint-plugin-import-x 4.18 changed type-import ordering (347 auto-fixable errors); typescript-eslint 8.74 added rules
  that found 38 real issues. Upgrade linters in their own reviewed change.
