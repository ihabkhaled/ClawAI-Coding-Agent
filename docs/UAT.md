# User acceptance checklist

## Connection and session

- [ ] Connect to a loopback HTTP backend.
- [ ] Connect to a hosted HTTPS backend.
- [ ] Confirm non-loopback HTTP and credential-bearing URLs are rejected.
- [ ] Confirm password masking and no password in settings/logs.
- [ ] Expire access token and confirm one refresh/retry.
- [ ] Log out while online and offline; local session clears in both cases.

## Models and chat

- [ ] Entitled active models appear with capabilities and local/connected state.
- [ ] AUTO omits a manual provider/model.
- [ ] Manual selection persists per workspace and falls back to AUTO if removed.
- [ ] Streaming text and provider/model attribution render incrementally.
- [ ] Cancellation stops the local request and calls backend cancellation.
- [ ] History opens persisted messages.
- [ ] Compare enforces two to five models; judge mode shows judged output.

## Context and safety

- [ ] Selection, active-file, workspace, and no-context modes work.
- [ ] Context receipt matches files sent and shows limit exclusions.
- [ ] `.env`, secret-like files, `.git`, dependencies, outputs, and binary files
      never enter context.
- [ ] Untrusted workspace blocks collection and edits but permits read-only chat.
- [ ] `.clawai` initialization creates all documented files without overwrite.
- [ ] Profile-wide rules and skills open and affect project workflows.

## Edits

- [ ] Generate/fix/tests/docs produce a strict plan.
- [ ] Invalid, absolute, traversal, secret, or oversized targets are rejected.
- [ ] Every file opens a before/after diff.
- [ ] Reject applies nothing.
- [ ] Approve applies all changes atomically.
- [ ] Session undo restores create/update/delete before-state.

## Accessibility and presentation

- [ ] Keyboard reaches skip link, route toggle, model tray, composer, and actions.
- [ ] Focus is visible and live updates are announced.
- [ ] Light, dark, and high-contrast themes remain readable.
- [ ] 200% zoom and narrow sidebar avoid horizontal loss.
- [ ] Arabic and Persian layouts are usable RTL.
- [ ] All 13 locales load without missing-key errors.

## Release

- [ ] `npm run check`, `npm run test:host`, runtime audit, and VSIX packaging pass.
- [ ] Clean-profile VSIX install activates within budget.
- [ ] VSIX contains no source, tests, maps, coverage, secrets, or nested package.
