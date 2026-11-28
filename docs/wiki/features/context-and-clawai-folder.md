# Context, receipts and the .clawai folder

> Decide exactly which of your files the model sees, see a receipt of what was included and left out, and keep project rules in a `.clawai` folder.

## Business why

- Source code is the customer's most sensitive asset, and ClawAI sends context to a backend that may be hosted. `../../SECURITY.md` residual risks: "Workspace content sent to a configured hosted backend leaves the local machine; the context receipt makes that set visible, but the backend operator remains part of the trust model."
- `../../PRODUCT.md` success criterion: "context receipts explain every included and excluded file". Persona: "privacy-conscious users who require explicit context and edit boundaries".
- Project rules in `.clawai` let a team steer the model the same way for every member without per-user setup.
- _Unknown - ask the owner and record the answer._ (No document ties context control to a plan, a sale or a compliance requirement.)

## Product why

- Problem: a model needs the right files, but sending everything is costly and risky; users want proof of what left the machine.
- Users: developers; teams with shared rules; reviewers who must see what was shared.
- How it shows up:
  - Context modes in the composer: `file`, `none`, `selection`, `smart`, `workspace` (`src/core/context-mode.ts`). Smart chooses selection, file, workspace or none from what is open.
  - A **Context** view listing included, excluded and truncated files.
  - **ClawAI: Initialize .clawai**, which creates missing files only. **Open Global Rules** and **Open Global Skills** for profile-wide guidance.
  - `@` mentions with fuzzy matching, `path:L-L` line ranges, a selection toggle, terminal output attach, dragged files (F032 to F037).
  - Context-window meter and warning (F040), conversation compaction (F041).
- Acceptance criteria found: sensitive paths "are kept out of the index entirely"; a mention of a range is marked changed or gone when the file is saved (1.26.0); attachments dragged from outside the open folder are refused (1.36.0).

## How it works

- Collection (`../../ARCHITECTURE.md`): paths are filtered before reading; byte and file budgets apply; the result is a receipt. Defaults: `clawAI.maxContextFiles` 40 and `clawAI.maxContextBytes` 200000 (`src/core/context-defaults.constants.ts`). Binary content is excluded. `.git`, dependency and output folders, `.env` and credential-like paths are always denied; `.clawai/ignore` and `clawAI.exclude` can only add exclusions.
- Files: `src/core/context-collector.ts`, `src/core/context-envelope.ts`, `src/core/context-prompt.ts`, `src/core/context-budget.ts`, `src/core/context-freshness.ts`, `src/core/context-compaction.ts`, `src/core/file-range-reference.ts`, `src/core/mention-match.ts`, `src/services/workspace-context-service.ts`, `src/services/mention-suggestion-service.ts`, `src/core/memory-file-discovery.ts`.
- `.clawai` layout (`../../CLAWAI_FOLDER_SPEC.md`): `rules.md`, `architecture.md`, `memory.md`, `ignore`, `policies/policy.json`, `agents/agents.json`, `context/*`, `skills/*`, `prompts/*`, `output-styles/*`, `mcp.json`, `workflows/`. Nested `.clawai` folders are read from the workspace root down to the open file, root first and nearest last, so the nearest speaks last (F076, 0.95.0).
- Editor help: `schemas/clawai-policy.schema.json` and `clawai-agents.schema.json` give autocomplete and validation for `policy.json` and `agents.json` (F085).
- Response room: a quarter of the context window is reserved for the answer, bounded 1,024 to 32,000 tokens (`src/core/context-budget.ts`).
- Receipts store a digest of the collected range, not of the whole file, so a save of a referenced file marks the range stale only when that range moved (F033).
- Security: workspace files are labelled untrusted data. Workspace Trust gates collection. In zero-retention mode uploads are refused client-side (`../../ARCHITECTURE.md`).

## Decisions

- `.clawai` content is advice and may only tighten. `policy.json` has no `allow` outcome because "workspace content is untrusted" (`../../CLAWAI_FOLDER_SPEC.md`).
- `skills/*.md` become slash commands (F077); the header is read by a three-field parser because "a full parser is a large attack surface for three fields".
- Built-in denials cannot be removed by `.clawai/ignore` (rule in `../../SECURITY.md`). Alternative rejected: an allowlist override.
- Attachment name screening cannot be extended by project config, because the webview sends a filename with no workspace path to match a glob (F050 residual).
- Context is bounded by files and bytes rather than tokens, with a window meter beside it (F040).
- Compaction: summarize with the conversation's own model and continue in a new thread, leaving the original intact (F041). `clawAI.autoCompact` default is to offer.
- Selection cannot be combined with file or workspace mode; modes are exclusive (F034 gap).

## History

- 2026-07-27: first release with bounded context receipts and `.clawai` (`../../ROADMAP.md`, Shipped in 0.1).
- 2026-07-28: scope coding actions to an explicit workspace folder (0.3.0).
- 2026-08-01: reviewed external output folders (0.16).
- 2026-09-09: `path:L-L` references (F033); nested memory files (F076); JSON schemas for policy and agents (F085, 0.84.0).
- 2026-09-10: @ mentions (0.98.0); composer reserves room for the answer (1.11.0); manual compaction (1.12.0); terminal references (1.15.0); automatic compaction (1.25.0); stale ranges (1.26.0); drag files (1.36.0).
- 2026-10-01: Run, Context and Web research remembered after reload (1.88.0).
- 2026-11-01: a run starts knowing the workspace's `CLAUDE.md` or `AGENTS.md` (1.104.0); compaction offer is a card in the chat (1.102.0).

## Tests and evidence

- `tests/unit/context-collector.test.ts`, `context-mode`, `context-budget`, `context-envelope`, `context-freshness*.test.ts`, `context-compaction`, `empty-context`: collection, modes, budgets, receipts, staleness.
- `tests/unit/workspace-context-service*.test.ts` (including `.file-ranges`), `file-range-reference`, `mention-match`, `mention-suggestion-service`, `memory-file-discovery`.
- `tests/unit/clawai-json-schemas.test.ts`: asserts the schemas and Zod sources have the same property set both ways. `clawai-workflow-schema.test.ts`.
- `tests/unit/auto-compaction`, `compaction-offer*`, `compact-conversation-command`.
- Playwright: `mentions.e2e.ts`, `context-warning.e2e.ts`, `compaction-offer.e2e.ts`.
- Live proof: not stated for context collection specifically. `../../parity/web-research-parity.md` (1.87.0 audit) states the V2 run start carries "the prompt and file ids; I found no call that feeds `contextMode` into it. The agent reads files through tools."

## Known gaps and risks

- Per `../../ROADMAP.md`, "explicit per-request context picker and token estimator" and "diagnostic/code-action context adapters" are candidates, not shipped.
- Terminal references keep only the last command per terminal; a terminal without shell integration is reported unreadable (F035).
- In Runtime V2 the Context mode may not reach the run start (1.87.0 audit). Current state not re-audited in the repo.
- Attachments cannot be extended by project config (F050).

## Open questions

- GAP: Does the Context mode now reach Runtime V2 runs?
- GAP: Why 40 files and 200,000 bytes as defaults?
- GAP: Is the receipt shown to the user for V2 tool reads, or only for collected context?
- GAP: Should `.clawai/ignore` ever remove a built-in exclusion for trusted repos?
