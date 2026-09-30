---
name: run-live-rounds
description: Run the live model-by-scenario matrix against a real ClawAI backend to prove which models can code. Use before a release or after changing agent execution, tools, or prompts.
---

# Run live rounds

`scripts/live-rounds.mjs` runs each scenario (`scripts/live-rounds.scenarios.mjs`) against
each model in a fresh workspace and thread. Assertions read the workspace, not the run's
own report. A failed round is recorded and the matrix continues.

## Steps

1. Backend up and the dev stack current (it answers 502 while rebuilding; the script waits).
2. Choose models from the backend route `/connectors/available-models`
   (`src/backend/model-catalog-client.ts`). Default: `CLAW_ROUND_MODELS` or `kimi-k3`.
3. Run:

```bash
CLAW_LIVE_EMAIL=... CLAW_LIVE_PASSWORD=... node scripts/live-rounds.mjs \
  --models=kimi-k3,glm-5.2 --scenarios=git-commit --repeat=3 --json=rounds.json
```

Flags: `--models`, `--scenarios` (default: the 8 `core` scenarios; `all` runs every one),
`--repeat`, `--json`. Env: `CLAW_LIVE_PROVIDER` (default `OLLAMA`). Single-model smoke
check: `npm run check:live`.

4. Record the exact command, the result matrix and the failures as evidence
   (`docs/parity/`, readiness pack). A lane not run is reported as not run.

## Harness limits

- Command timeout 30 s, backend readiness wait 180 s (`scripts/live-agent-session.constants.mjs`).
- The token is re-authorised during the run; a long matrix outlives one access token.
- Planted facts change each round on purpose; do not hardcode them.
- Never commit credentials, or a `rounds.json` holding prompts you would not publish.

## Pitfalls

- 502s during a source rebuild are not model failures; rerun once the stack settles.
- Tool counts and model narration are not completion; only the workspace assertion counts.
