# Refined plan — parity program and readiness pack, merged

Written 2026-09-12 at version 1.47.0, branch `feat/claude-parity-program`.
Supersedes the plan implied by `PROGRAM.md` alone. Read with `HANDOVER.md`,
`docs/RULES.md`, `skills/verify-coding-agent-readiness/SKILL.md` and
`docs/AGENT_READINESS_EXECUTION_PACK.md`.

This is a plan, not a report of work done. Nothing below is executed until the
release owner gives the signal.

---

## 1. What changed: there are two axes, and only one was being tracked

The program has been measuring **one** thing — does a feature exist in the code
— across 108 rows. The readiness pack and `docs/RULES.md` introduce a **second**
axis that the program never tracked: is the feature _reachable, installed, and
proven by evidence_.

The two are independent, and the second is now the binding one.

| Axis          | Question                                | Tracked in                             | Status                     |
| ------------- | --------------------------------------- | -------------------------------------- | -------------------------- |
| A — Parity    | Does the capability exist?              | `AUDIT_F*.md`, `PROGRAM.md`            | 108 rows classified        |
| B — Readiness | Is it reachable, installed, and proven? | `RULES.md`, readiness skill, this plan | **Not yet tracked at all** |

`RULES.md` rule 1 is the sentence that reorganises the program:

> A command, setting, view, tool or service is delivered only when a reachable
> call path and an appropriate test demonstrate it. Dormant code is not a feature.

Every one of the 61 SHIPPED rows was classified by reading code. None was
classified by demonstrating a reachable call path. **Under rule 1, "SHIPPED" on
axis A is not a delivery claim.** That is not a reason to renumber them
downward; it is a reason to add the second axis and let a row be honest on both.

---

## 2. Current state, both axes

### Axis A — parity, recounted from the tables today

| Status    | Count   |
| --------- | ------- |
| SHIPPED   | 61      |
| PARTIAL   | 27      |
| MISSING   | 17      |
| BLOCKED   | 2       |
| CONFLICT  | 1       |
| **Total** | **108** |

Fully shipped **61/108 = 56/100**. Weighted with partials at half, **70/100**.

Recount before trusting this:

```bash
awk -F'|' '/^\| F0|^\| F1/ {gsub(/^ +| +$/,"",$4); split($4,a," "); print a[1]}' <file> | sort | uniq -c
```

### Axis B — readiness, measured for the first time

The product surface that rule 6 requires an inventory of:

| Surface                  | Count   | Inventory rows exist? |
| ------------------------ | ------- | --------------------- |
| Contributed commands     | 43      | No                    |
| Settings                 | 24      | No                    |
| Views                    | 9       | No                    |
| Keybindings              | 11      | No                    |
| Runtime tool definitions | 29      | No                    |
| **Total rows required**  | **116** | **0 written**         |

`INSTALLED_UAT.md` looks like this ledger and is not. It stops at version
0.79.0, covers batches 1–15, and contains no PASS/FAIL/BLOCKED/NOT RUN row. It
is a record of four old VSIX hashes, not an inventory.

**Every one of the 116 rows is therefore NOT RUN.** That is the honest starting
number for axis B.

### Test lanes that exist, and which the gate actually runs

| Lane                                                                                                                 | In `npm run check`? | Proves                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------- |
| `format:check`, `l10n:verify`, `lint`, `typecheck`, `scan:paths`, `coverage:scope`, `test`, `build`, `package:audit` | Yes                 | Source is correct and well-formed             |
| `test:host`                                                                                                          | No                  | Source tree activates in real VS Code         |
| `test:host:installed`                                                                                                | No                  | The packaged VSIX activates as shipped        |
| `test:playwright` (14 specs)                                                                                         | No                  | Webview controls behave                       |
| `check:live`                                                                                                         | No                  | A model reads, writes, runs and corrects code |

Four lanes sit outside the gate. Three of them are the only lanes that say
anything about axis B.

### Version alignment, which was broken and now is not

The pack recorded installed 1.30.0 against source 1.46.0 — different artifacts,
so no UAT observation could be attributed to current source. Source and
installed both report **1.47.0** now, so observations are attributable again.
Rule 5 governs from here: each delivery advances the second component, with no
two-digit ceiling.

---

## 3. What this release already closed

- **The callback defect.** The page promised an automatic close that browsers
  refuse for any tab a script did not open, and left the OAuth code and state in
  the address bar. It now strips them, keeps its nonce-only CSP, and states only
  what is true. `Open Chat` is navigation-only and cannot carry a payload.
- **13 locales** for the callback strings, through the same generator as every
  other user-facing message.
- **The rules are written down**, not remembered: `docs/RULES.md` (6 rules) and
  `skills/verify-coding-agent-readiness/SKILL.md`.
- **The version policy** is recorded in `skills/version-every-change/SKILL.md`.
- **Parent knowledge and inventory** regenerated; both previously failing gates
  pass; the submodule pointer advanced.

---

## 4. What is missing — the refined backlog

Ordered by what unblocks the most. Each phase has an exit criterion that is an
observation, not an assertion.

### Phase 1 — Build the ledger that rule 6 requires

Create `docs/parity/SURFACE_INVENTORY.md`: one row per command, setting, view,
keybinding and runtime tool. Columns: surface, identifier, reachable call path,
lane that proves it, status, evidence.

Generate the row skeleton from `package.json` and the tool definitions rather
than typing it, so the inventory cannot silently fall behind the manifest. Add a
check that fails when a contributed identifier has no row.

**Exit:** 116 rows exist, every one carrying a status. Most will read NOT RUN on
day one, and that is the correct starting value.

### Phase 2 — Reconcile axis A against rule 1

Walk the 61 SHIPPED rows. For each, find the reachable call path and the test
that demonstrates it. A row with neither becomes an axis-B NOT RUN with a named
reason; it does not change its axis-A classification.

**Exit:** every SHIPPED row cites either a proving test or a specific reason it
cannot be proven yet. Expect this to reclassify some rows; the audits' own
instruction is "recount, never adjust".

### Phase 3 — Close the runtime symptom the pack opened

`RUNTIME_STATE_UNAVAILABLE` was observed by the user against installed 1.30.0.
Source already retries only tagged transport conditions from the saved cursor,
and the backend carries a one-hour runtime TTL. With 1.47.0 now installed, the
symptom is observable against current source for the first time.

Verify rule 2 directly: a tagged transport or state-store interruption resumes
from the event cursor; terminal, permission, tool, validation, budget and
unsafe-operation outcomes are never retried as transport failures. Add the
failure-path regression test if it does not exist.

**Exit:** a reproduction attempt on 1.47.0 with a recorded outcome, and a test
that fails if a non-transport error is ever retried as one.

### Phase 4 — Prove the extension's own executors

The live lane proves the model codes, but supplies its own tool implementations.
The file transaction adapter, bounded command runner, git tools and approval
flow are covered by unit tests and nothing live. The extension exposes no API to
seed a session into a host, and adding product surface purely for tests is the
wrong trade.

Options, to be decided before coding: drive the real executors through the
Playwright webview lane; or add a test-only activation path gated on
`ExtensionMode.Test`, which VS Code sets and a user cannot.

**Exit:** a decision recorded as an ADR, then the chosen lane running green.

### Phase 5 — The pack's explicit NOT RUN items

- **Live provider run.** The Kimi-labelled catalog entries inspected were Ollama
  entries reporting `supportsTools: false`. That is a readiness finding about
  those entries, not proof Kimi k3 is unavailable. Run a live coding task on an
  entitled tool-capable provider and record provider, model and independently
  executed output.
- **Research parity.** Extension research is typed and server-owned through
  `/research/search` and `/research/fetch`. Needs a live scenario.
- **Crawl parity.** Requires a live scenario against the web application's
  actual crawl flow plus an extension call-path inventory. Currently NOT RUN.

**Exit:** each item PASS or FAIL with evidence, never silence.

### Phase 6 — Resume axis A

Return to the remaining 17 MISSING, 27 PARTIAL, 2 BLOCKED, 1 CONFLICT rows, in
the batch rhythm already established. The CONFLICT row (F046, permission modes)
needs a decision from the release owner before any code.

---

## 5. Changes to how a batch is done

Merging the pack into the existing rhythm changes the per-batch checklist:

1. Read the audit row and the inventory row before writing code.
2. Declare the knowledge delta by path.
3. Implement, with a test for every behaviour.
4. Check the three ripple sites for any new tool operation.
5. Update `PROGRAM.md`, the audit row, the tally (recount, never adjust).
6. **Update the surface inventory row with its new status and evidence.**
7. CHANGELOG entry and the five version sites; **second component, no ceiling**.
8. `npm run check` — once, at the end.
9. **`test:host`, `test:host:installed`, `test:playwright`** — the three lanes
   that were outside the gate.
10. Commit with explicit paths, push before the next commit.
11. Package, install into a disposable profile, verify the installed version
    _matches the source version_ before believing any UAT observation.
12. Send the VSIX.
13. State plainly what was narrowed and what remains NOT RUN.

---

## 6. Conflicts and decisions the owner must make

| #   | Question                                                                | Why it cannot be decided here                            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | F046 permission modes: the pack and the shipped model disagree          | A product decision about what a mode means               |
| 2   | Phase 4 approach: Playwright lane, or a test-only activation path       | Adds product surface; a trade only the owner should make |
| 3   | Does axis A stay at 108 rows, or do rule-1 failures reopen closed rows? | Changes what "56/100" means to anyone reading it         |
| 4   | Push `main` in the parent repository                                    | Currently committed locally and deliberately unpushed    |

---

## 7. Ready to execute

Phase 1 is fully specified and needs no decision. It is the natural first move
on the signal, because every later phase writes into the ledger it creates.

Phases 3 and 5 need a running stack and an entitled provider. Phase 4 is blocked
on decision 2. Phase 6 resumes the work already in flight.
