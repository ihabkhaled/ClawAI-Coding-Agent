# knowledge.context, notes, rules, skills and memory

> The agent starts a run knowing your project's rules, can search them, keeps its own working notes, and reads your rule, skill and memory files in the order you set.

## Business why

- Teams already write rules in `CLAUDE.md`, `AGENTS.md` and rule files. Letting the agent follow them makes its output match the team's standards without per-user setup. 1.104.0: "The panel's agent now starts a run knowing the project's rules."
- Rules are advice, not authority: "they cannot add a tool, an approval or write access" (`../../TOOLS.md`). This keeps a cloned repository from widening what the agent may do (`../../SECURITY.md`).
- The repo applies this to itself: `../../RULES.md` rule 18 requires "the business, product and technical why, before and after" for every change.
- _Unknown - ask the owner and record the answer._ (No document gives the commercial value of rule-following beyond adoption.)

## Product why

- Problem: a model with no project knowledge breaks conventions, and long runs repeat reading what they already learned.
- Users: developers with repository rules; teams with shared skills; CLI users with `--load-knowledge`.
- How it shows up:
  - `knowledge.context` tool (`index`, `read`, `search`, `task`). In the panel since 1.105.0; `--load-knowledge` in the CLI (SDK `loadKnowledge: true`).
  - A rules summary in front of each new task: title, sections, rules under "never", "must" and "prohibition" headings, at most 3,000 characters, with a pointer to read the full file (1.104.0). Setting `clawAI.loadKnowledge` default `true`.
  - `workspace.notes`: `add`, `read`, `replace`, `remove`, `clear`.
  - `.clawai` rules, architecture, memory (nested), `skills/*.md` as slash commands such as `/review`, output styles via **ClawAI: Select Output Style** (default, concise, explanatory, learning). Global `global-rules.md` and `global-skills.md` open with **Open Global Rules / Open Global Skills**.
  - Backend thread memory: threads can have memory on or off (`useMemory`); `../../parity/PARTIAL_REMAINDERS.md` records a fixed server bug where runs with memory off still read saved memory.
- Acceptance criteria found: a nested `CLAUDE.md` in the folder a task mentions is found; a path outside the workspace is refused (1.105.0 host proof). A new conversation starts with an empty notebook, "so notes from an old task cannot steer it" (1.86.0).

## How it works

- `knowledge.context` (`../../TOOLS.md`): only markdown and knowledge folders inside the workspace; honours `.gitignore`; never enters `node_modules`, `dist` or `.git`. `read` returns 8,000 characters (a large file returns an outline with line ranges); `task` returns the governing rule, skill and instruction files with line ranges (6 KB at most). Results are marked untrusted and redacted. Files: `src/infrastructure/knowledge-tool-executor.ts`, `src/sdk/knowledge-*.ts` (corpus, chunks, index, search, task, read, sanitize), `src/services/runtime-studio-knowledge.ts`.
- Notes: at most 200 notes and 64 KB per conversation; 2,000 characters per note; secrets redacted; kept outside the workspace (`<state-dir>/notes`) so they cannot be committed; survive `--resume`. Files: `src/sdk/notes-store.ts`, `notes-tool.ts`.
- Memory files: every directory from the workspace root down to the open file is searched for `.clawai/rules.md`, `architecture.md`, `memory.md`, root first and nearest last; the walk is depth-bounded and refuses `..` or an absolute path (F076, 0.95.0). `src/core/memory-file-discovery.ts`.
- Skills (F077): optional three-field header (`name`, `description`, `argument-hint`); `$ARGUMENTS` and `$1..$9`; project skills override profile-wide ones; expansion happens once in the coordinator before any transport; an unknown command is sent as text. Built-in `/security-review` (F106). Files: `src/core/skill-definition.ts`, `src/core/slash-command.ts`, `src/services/skill-catalog-service.ts`, `src/infrastructure/vscode-skill-source.ts`.
- Output styles (F082): four built-in plus `.clawai/output-styles`; Plan mode is applied first as a constraint and the style second as a preference; style preambles stay English.
- Quoted as untrusted repository text; grants nothing.

## Decisions

- Knowledge and rules are advice, never grants. Alternative rejected: letting repository files add tools or approvals.
- Skill header parsed by a three-field parser, not a YAML library: "a full parser is a large attack surface for three fields" (`../../CLAWAI_FOLDER_SPEC.md`).
- Notes live outside the workspace, so they cannot be committed and cannot leak into a repository (`../../TOOLS.md`).
- Fresh notebook for each new conversation (1.86.0).
- Memory order is precedence: nearest speaks last.
- Output styles reuse the skill parser, because F077 "was the gate for exactly this reuse" (F082).
- `clawAI.loadKnowledge` is on by default; the SDK uses an opt-in flag.

## History

- 2026-09-09: nested `.clawai` memory files (F076, 0.95.0).
- 2026-09-10: skills become slash commands (1.7.0); output styles (1.8.0).
- 2026-09-30: new conversation starts with an empty notebook (1.86.0).
- 2026-10-01: thread memory root cause recorded and fixed in the ClawAI monorepo; checked live (six runs with memory off all answered `NO-MEMORY`).
- 2026-10-02: repository knowledge and notes in the CLI and SDK (1.96.0, `feat(sdk): ... knowledge ...`).
- 2026-11-01: a run starts knowing `CLAUDE.md` or `AGENTS.md` (1.104.0); `knowledge.context` in the panel (1.105.0).

## Tests and evidence

- `tests/unit/knowledge-tool.test.ts`, `knowledge-tool-executor`, `knowledge-headless`, `knowledge-injection`, `knowledge-parts`, `knowledge-glob-match`, `runtime-studio-knowledge`, `adv-knowledge`.
- `tests/unit/notes-tool.test.ts`, `notes-store`, `notes-continuation`, `create-agent-fresh-notes`.
- `tests/unit/memory-file-discovery.test.ts`, `skill-definition`, `skill-expansion`, `skill-catalog-service`, `slash-command`, `output-style`, `output-style-catalog`, `built-in-skill-l10n`.
- Playwright: `slash-commands.e2e.ts`.
- Live proof, as stated: 1.105.0 "Proven in a real VS Code extension host: the root file is read, a nested `CLAUDE.md` is found, and a path outside the workspace is refused." Thread-memory fix checked live on 2026-10-01 (`../../parity/PARTIAL_REMAINDERS.md`).

## Known gaps and risks

- The agent does not yet reliably recall a fact from a different conversation (1.74.0 known gap).
- Skill files can be absent or malformed; a bad header costs the header, not the skill.
- Attachments name screening cannot be extended by project config (F050).
- Knowledge search quality is bounded to markdown and knowledge folders only.

## Open questions

- GAP: Is cross-conversation recall a target, and for which release?
- GAP: Who set the 3,000 character rules summary cap?
- GAP: Should notes ever be shareable with the team?
- GAP: Should `loadKnowledge` be on for the CLI by default?
