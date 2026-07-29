# ClawAI Coding Agent 0.7.1 security and continuity hotfix

## Problem

The 0.7.0 connection gateway improved first-run UX but exposed two trust-boundary races: a new backend origin became active before authorization succeeded while tokens used one origin-agnostic key, and concurrent Connect messages could launch multiple browser flows. Reliability review also found broken repair threads, non-cancellable compare requests, file-only coding commands, globally bound Retry behavior, offline logout drift, and Full Access bypassing final diff review.

## Product decision

0.7.1 is a correctness release, not a visual redesign. It guarantees:

- credentials are readable only by the normalized backend origin that issued them;
- backend configuration activates only after browser authorization and profile validation succeed;
- one authorization attempt exists at a time and can be cancelled immediately;
- repair, compare, cancellation, logout, and Retry retain coherent request state;
- coding commands collect workspace context without requiring an active editor;
- every final file diff remains an explicit in-extension approval boundary.

## Authentication model

SessionVault namespaces SecretStorage entries by a SHA-256 digest of the normalized origin. The unattributed legacy clawAI.session value is deleted rather than guessed into an origin, requiring one safe reconnect after upgrade. Every BackendClient supplies its own origin for load, save, refresh, and clear.

Connect builds a candidate backend without mutating active configuration. Authorization tokens remain staged while profile validation runs against that candidate. Only a still-owned successful attempt persists the token pair and activates replacement chat/model/data clients. Failure or cancellation never writes candidate credentials.

Browser authorization installs an attempt guard before its first await. Duplicate calls share one attempt. Cancel aborts the attempt and disposes the callback whether cancellation happens before loopback startup, token exchange, or profile validation. Credential and account epochs prevent late refresh and data writes after logout or origin replacement.

## Agent continuity

Malformed edit-plan repair stays in the first response thread and aggregates both token receipts. Generate Code, Generate Tests, Compare, and Judge use workspace context. Compare and Judge pass the scheduler AbortSignal to HTTP. Retry captures its original prompt, run mode, context mode, and comparison model set instead of consulting a global latest prompt.

## Safety and accessibility

Offline logout is best-effort: local credentials and connected state clear even when the server is unavailable. Account reset invalidates in-flight history and clears retained-tab transcripts. Final diff approval is mandatory in every permission mode. The gateway exposes Cancel during authorization; successful connection moves focus to the composer and announces the transition.

## Verification

Unit tests cover origin isolation and migration, atomic endpoint switching, concurrent/cancelled authorization, offline logout, same-thread repair/token aggregation, abort propagation, workspace command defaults, and mandatory final review. Playwright covers connection cancellation, focus transfer, and request-bound Retry. Localization, lint, strict TypeScript, coverage, browser, extension-host, audit, package, install, release, and parent-PR gates remain mandatory.
