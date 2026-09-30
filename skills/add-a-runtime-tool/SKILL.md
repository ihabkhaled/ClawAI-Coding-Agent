---
name: add-a-runtime-tool
description: Add or extend a runtime (agent) tool in the ClawAI Coding Agent. Use when the model needs a new tool or a new operation on an existing tool.
---

# Add a runtime tool

A tool is delivered only when the model can call it, policy classifies it, and a
test proves both (`docs/RULES.md` rule 1).

## Steps

1. **Schema.** Add the operation's strict input schema in
   `src/core/runtime/runtime-tool-input-schemas.ts` using `strict({...}, [required])`.
   Bounded values only: no `pattern`, set `maxLength`/`maxItems`.
2. **Definition + executor.** Put the executor in `src/infrastructure/<name>-tool-executor.ts`
   (VS Code adapters) or `src/services/` (pure ports); export a `<name>ToolDefinition`.
   Types go in `*.types.ts`, constants in `*.constants.ts`.
3. **Register.** Add `{ definition, executor }` in
   `src/services/runtime-studio-registrations.ts` (see the `notifyUserToolDefinition` entry).
   Execution wiring lives in `src/services/vscode-runtime-execution.ts`.
4. **Policy class.** In `src/services/runtime-policy-v2-adapter.ts` `classify()`:
   give the tool an `effect`, a risk (`R0`-`R4`) and `reversible`. Anything that
   mutates local state is at least `local-mutation` / `R3`. Do not leave a mutating
   tool to fall through to the read-only default.
5. **Approval.** Mutating operations go through `approve(request)` in the adapter;
   never bypass Workspace Trust, secret, path or command safety.
6. **Redaction.** Results pass through `src/core/redaction.ts`; do not log arguments.
7. **Tests** in `tests/unit/`: executor success and failure, schema
   (`runtime-tool-input-schemas.test.ts`), catalog (`runtime-tool-catalog.test.ts`),
   policy classification, and `runtime-executable-tools.test.ts` (every declared tool has an executor).
8. **Inventory + docs.** `npm run inventory:surface`; update `docs/API_CONTRACTS.md`
   only if a backend contract changed. Add a CHANGELOG line only once step 3 is reachable.

## Commands

```bash
npx vitest run tests/unit/runtime-tool-catalog.test.ts tests/unit/runtime-executable-tools.test.ts
npm run inventory:surface
git add <new files>   # coverage:scope reads tracked files
npm run coverage:scope
```

## Pitfalls

- A tool defined but not registered is scaffolding; the model sees a tool that fails.
- New user-facing strings need all locales (`skills/add-a-translated-string`).
