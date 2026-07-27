# Backend API contracts

The configured origin is normalized and every path below is prefixed with
`/api/v1`. Runtime Zod schemas in `src/backend/contracts.ts` are authoritative
for the fields consumed by the extension.

| Method   | Path                                     | Use                                                    |
| -------- | ---------------------------------------- | ------------------------------------------------------ |
| POST     | `/auth/login`                            | Login with email/password and `VSCODE` client metadata |
| POST     | `/auth/refresh`                          | Rotate the refresh-token session                       |
| POST     | `/auth/logout`                           | Revoke the current session                             |
| GET      | `/auth/me`                               | Current user profile                                   |
| GET      | `/auth/me/entitlements`                  | Plan, model/provider grants, quota                     |
| GET      | `/auth/me/usage`                         | Day/week/month and feature usage                       |
| GET      | `/routing/models`                        | Execution-capable routing models                       |
| GET      | `/connectors/available-models`           | Connected provider models                              |
| POST/GET | `/chat-threads`                          | Create and list conversations                          |
| GET      | `/chat-messages/thread/:threadId`        | Persisted thread messages                              |
| POST     | `/chat-messages`                         | Send one routed message                                |
| POST     | `/chat-messages/parallel`                | Compare two to five models                             |
| GET      | `/chat-messages/stream/:threadId`        | SSE response stream                                    |
| POST     | `/chat-messages/stream/:threadId/cancel` | Cancel active generation                               |

AUTO requests omit provider/model. Manual requests send the chosen provider and
model from the entitlement-filtered catalog. Compare requests contain two to
five provider/model pairs and optional judge fields.

Expected SSE events include provider/model attribution, content deltas or
snapshots, terminal `DONE`, and `ERROR`. Unknown event fields are tolerated;
the extension acts only on known fields. Individual events are size-bounded.

Contract changes require synchronized backend and extension tests. Do not use
undocumented service-private endpoints.
