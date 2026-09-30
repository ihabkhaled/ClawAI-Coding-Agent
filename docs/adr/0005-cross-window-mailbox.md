# ADR 0005: cross-window messaging is a per-user file mailbox

- Status: accepted
- Date: 2026-09-30
- Resolves: F010 (cross-session messaging) in `docs/parity/AUDIT_F001_F031.md`
- Code: `src/core/cross-window-mailbox.constants.ts`,
  `src/core/cross-window-mailbox.types.ts`,
  `src/infrastructure/cross-window-mailbox-store.ts`,
  `src/infrastructure/cross-window-mailbox-files.ts`,
  `src/infrastructure/cross-window-mailbox-schema.ts`,
  `src/infrastructure/vscode-cross-window-mailbox.ts`

## Context

Steering messages already reach sessions inside one window (agent mailbox,
`runtime-steering-queue.ts`). F010 asks for mail between separate VS Code
windows of one user. Extension hosts are separate processes with no shared
memory, and the extension has no daemon and must not open a network listener
for this.

## Decision

Windows exchange messages through plain files under
`<globalStorage>/mailbox`, one directory per user, shared by every window.

- **Addressing.** A peer is `window:<id>` (`WINDOW_ADDRESS_PREFIX`). Only a
  window's main session is addressable; sub-agents cannot be addressed across
  windows.
- **Presence.** Each window rewrites a heartbeat file in `peers/` every 10 s. A
  heartbeat older than 30 s means the window is gone, because a crashed window
  never cleans up. At most 20 peers are listed.
- **Delivery.** A sender writes one JSON file into the recipient's `inbox/`.
  Writes are atomic (temp file with the `.tmp-` prefix, then rename; the rename
  retries 4 times with a 15 ms backoff because Windows refuses a rename while
  another process holds the file). Readers ignore temp files.
- **Bounds.** Message 2,000 characters; inbox 50 messages and 128 KiB; 40 sends
  per window; unread messages dropped after 10 minutes; the last 500 seen ids
  remembered for deduplication.
- **Trust.** Every file is untrusted input: zod-validated, key names checked
  as safe path segments, text redacted (`redactText`) on the way in. Mail is
  refused under zero-retention mode and in an untrusted workspace (the
  `refusal` callback).

## Consequences

- No network surface, no new dependency, no backend contract. Works offline.
- Same user and same machine only. A different machine or OS user is out of
  scope; that is the runner and remote path (F095, F098).
- Delivery is at-most-once with a TTL, not durable: a message nobody reads in 10
  minutes is dropped on purpose.
- Anything that can write the user's globalStorage can forge mail. That is the
  same trust level as the user's own settings, which is why content is treated
  as a steering suggestion, not a command.
- Files persist on disk while unread; zero retention refuses the feature
  rather than trying to scrub it.
