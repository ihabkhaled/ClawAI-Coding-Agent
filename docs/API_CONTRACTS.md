# Backend API contracts

The configured origin is normalized and every path below is prefixed with
`/api/v1`. Runtime Zod schemas in `src/backend/contracts.ts` are authoritative
for the fields consumed by the extension.

| Method   | Path                                          | Use                                                 |
| -------- | --------------------------------------------- | --------------------------------------------------- |
| POST     | `/auth/vscode/authorize/init`                 | Create a PKCE browser-authorization request         |
| POST     | `/auth/vscode/authorize/exchange`             | Exchange the completed one-shot request for tokens  |
| POST     | `/auth/refresh`                               | Rotate the refresh-token session                    |
| POST     | `/auth/logout`                                | Revoke the current session                          |
| GET      | `/auth/me`                                    | Current user profile                                |
| GET      | `/auth/me/entitlements`                       | Plan, model/provider grants, quota                  |
| GET      | `/auth/me/usage`                              | Day/week/month and feature usage                    |
| GET      | `/agent/runtime/protocol`                     | Authenticated V1/V2 runtime negotiation descriptor  |
| POST     | `/chat-messages/runtime/runs`                 | Start one authenticated Runtime V2 run              |
| POST     | `/chat-messages/runtime/runs/:runId/results`  | Submit an idempotent tool result                    |
| POST     | `/chat-messages/runtime/runs/:runId/steering` | Add bounded steering to an active run               |
| POST     | `/chat-messages/runtime/runs/:runId/cancel`   | Cancel an active Runtime V2 run                     |
| GET      | `/routing/models`                             | Execution-capable routing models                    |
| GET      | `/connectors/available-models`                | Connected provider models                           |
| POST     | `/files/upload`                               | Upload one validated request attachment             |
| DELETE   | `/files/:id`                                  | Delete an authenticated user's request-owned upload |
| POST/GET | `/chat-threads`                               | Create and list conversations                       |
| GET      | `/chat-messages/thread/:threadId`             | Persisted thread messages                           |
| POST     | `/chat-messages`                              | Send one routed message                             |
| POST     | `/chat-messages/parallel`                     | Compare two to five models                          |
| GET      | `/chat-messages/stream/:threadId`             | SSE response stream; `replay=false` is live-only    |
| POST     | `/chat-messages/stream/:threadId/cancel`      | Cancel active generation                            |

AUTO requests omit provider/model. Manual requests send the chosen provider and
model from the entitlement-filtered catalog. Compare requests contain two to
five provider/model pairs and optional judge fields. Chat, compare, and coding
agent requests may include backend-owned `fileIds` returned by `/files/upload`;
raw attachment bytes never enter a chat-message body.

Expected SSE events include provider/model attribution, content deltas or
snapshots, terminal `DONE`, and `ERROR`. Unknown event fields are tolerated;
the extension acts only on known fields. Individual events are size-bounded.
The extension uses `replay=false` for active runs so older buffered model,
failure, and completion events cannot enter a new request on a reused thread.

Contract changes require synchronized backend and extension tests. Do not use
undocumented service-private endpoints.

The runtime descriptor contains bounded version and transport lists, inert
foundation feature flags, and event/run limits. It never receives a request
body, capability manifest, workspace URI, environment value, or secret. The
server prefers `2.0`, supports `1.0`, uses authenticated SSE, and reports
`toolExecution: true`. Runtime streams use
`/chat-messages/stream/:threadId?protocol=v2&runId=...&generation=...&after=...`
for ordered resume from the last accepted event sequence.
