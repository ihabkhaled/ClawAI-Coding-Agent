# User acceptance checklist

## Connection and session

- [ ] Connect to a loopback HTTP backend.
- [ ] Connect to a hosted HTTPS backend.
- [ ] Confirm non-loopback HTTP and credential-bearing URLs are rejected.
- [ ] Confirm Connect opens the ClawAI web app and no password is collected by
      the extension.
- [ ] Expire access token and confirm one refresh/retry.
- [ ] Log out while online and offline; local session clears in both cases.

## Models and chat

- [ ] Entitled active models appear with capabilities and local/connected state.
- [ ] AUTO omits a manual provider/model.
- [ ] Manual selection persists per workspace and falls back to AUTO if removed.
- [ ] Installed Ollama and ready llama.cpp models appear once in the local group.
- [ ] Streaming text and provider/model attribution render incrementally.
- [ ] Cancellation stops the local request and calls backend cancellation.
- [ ] History opens persisted messages.
- [ ] Compare enforces two to five models; judge mode shows judged output.

## Context and safety

- [ ] Selection, active-file, workspace, and no-context modes work.
- [ ] Smart context with no active editor uses the trusted workspace or empty
      context without showing “Open a file before running this command.”
- [ ] Context receipt matches files sent and shows limit exclusions.
- [ ] `.env`, secret-like files, `.git`, dependencies, outputs, and binary files
      never enter context.
- [ ] Untrusted workspace blocks collection and edits but permits read-only chat.
- [ ] `.clawai` initialization creates all documented files without overwrite.
- [ ] Profile-wide rules and skills open and affect project workflows.

## Edits

- [ ] Plan mode returns a read-only implementation plan and never applies files.
- [ ] Ask for Approval prompts before workspace context and edit generation.
- [ ] Approve for me and Full Access skip their documented routine prompts.
- [ ] Full Access requires its one-time warning; final diff review remains
      mandatory in every mode.
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

- [ ] `npm run check`, `npm run test:host`, `npm run test:playwright`, runtime
      audit, and VSIX packaging pass.
- [ ] Clean-profile VSIX install activates within budget.
- [ ] VSIX contains no source, tests, maps, coverage, secrets, or nested package.
