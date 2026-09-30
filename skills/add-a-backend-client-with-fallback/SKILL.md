---
name: add-a-backend-client-with-fallback
description: Add a client for a ClawAI backend route that older backends may not have. Use when the extension ships ahead of the backend migration.
---

# Add a backend client with fallback

The extension must keep working against a backend that predates the route.

## Steps

1. Client in `src/backend/<name>-client.ts`; `src/backend/` is the only HTTP layer.
   Use the shared requester (`ResearchRequester` / `Requester`), never a bare `fetch` elsewhere.
2. Validate every response with a zod schema (`*.schemas.ts`); types in `*.types.ts`,
   constants in `*.constants.ts`. Never trust an unvalidated body.
3. Treat a missing route as an answer, not a crash: catch `BackendRequestError` and map
   `404/405/501` to a typed result. Model: `ROUTE_MISSING` and `route-missing` in
   `src/backend/artifact-client.ts`; see also `usage-breakdown-client.ts`,
   `remote-session-client.ts`. Rethrow every other error unchanged (401 refresh is central).
4. Callers show an honest, localized degraded state ("your backend does not support X yet"),
   never a silent success.
5. Document the route and the backend version/migration it needs in `docs/API_CONTRACTS.md`.
6. User-visible errors go through `src/backend/backend-error-message.ts`; redact bodies.
7. Tests in `tests/unit/`: success, 404 fallback, 5xx propagation, schema mismatch, abort.
8. If security-critical, add the file to `NAMED_CRITICAL_FILES` in
   `scripts/labs/verify-coverage-scope.mjs` and to the coverage include in `vitest.config.ts`.

## Commands

```bash
npx vitest run tests/unit/<name>-client.test.ts
npm run coverage:scope
```

## Pitfalls

- Hosted backends require HTTPS; do not relax it for tests.
- A client with no caller is dormant code (rule 1): wire it before claiming it.
