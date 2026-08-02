# User acceptance checklist

## Connection and session

- [ ] With the 0.18 agent-service endpoint available, authenticate and confirm
      the connection remains healthy after V2 negotiation.
- [ ] Return 404, malformed JSON, V1-only versions, and a transport mismatch
      from `/agent/runtime/protocol`; confirm legacy chat and reviewed edits
      remain available without a connection error.
- [ ] Expire the access token during negotiation; confirm one refresh/retry.
- [ ] Cancel or switch account/backend during negotiation; confirm the stale
      result never enters extension state.
- [ ] Activate simulated local, WSL, SSH, Dev Container, Codespaces, web,
      virtual, untrusted, empty, and multi-root probes; confirm the manifest
      never overclaims write or shell capability.

- [ ] On a fresh profile, confirm only the connection gateway is visible; chat
      history, models, workspace status, suggestions, and composer are hidden.
- [ ] Keep the `https://claw.local` default once, then repeat with an edited
      backend URL. Confirm both start browser authorization without a VS Code
      input dialog.
- [ ] Confirm authorization progress disables duplicate Connect submissions and
      exposes one keyboard-focused Cancel action; a backend failure appears
      inline without revealing the workbench.
- [ ] Leave browser authorization unfinished for two minutes. Confirm it times
      out, restores Connect, and the next click opens a different fresh link.
- [ ] Connect to a loopback HTTP backend.
- [ ] Connect to a hosted HTTPS backend.
- [ ] Confirm non-loopback HTTP and credential-bearing URLs are rejected.
- [ ] Confirm Connect opens the ClawAI web app and no password is collected by
      the extension.
- [ ] Close/reopen the editor tab, create another VS Code window, reload, and
      restart VS Code; confirm the same SecretStorage session remains connected.
- [ ] Expire access token and confirm one refresh/retry.
- [ ] Log out while online and offline; local session clears in both cases.
- [ ] Configure two backend origins and confirm each loads only its own stored
      session. A failed Connect attempt must preserve the previously saved URL;
      a direct settings change must clear the old account before validation.
- [ ] Reconnect after logout and confirm retained tabs contain no prior-account
      transcript or late-arriving history.

## Models and chat

- [ ] Entitled active models appear with capabilities and local/connected state.
- [ ] AUTO omits a manual provider/model.
- [ ] Manual selection persists per workspace and falls back to AUTO if removed.
- [ ] Change models and immediately send queued prompts. Confirm each response
      uses the model shown when that prompt was submitted and never displays
      events or failures from an older run on the same thread.
- [ ] Installed Ollama and ready llama.cpp models appear once in the local group.
- [ ] Streaming text, progress, validation, repair, and provider/model
      attribution render incrementally in one response without repeated
      transport messages.
- [ ] Cancellation stops the local request and calls backend cancellation.
- [ ] History opens persisted messages.
- [ ] The top ClawAI action creates independent editor tabs, each tab title
      follows its conversation subject, and the history selector restores a
      thread in the selected tab.
- [ ] Prompt, activity, file, response, and conversation token counters remain
      visible while streaming and distinguish reported values from estimates.
- [ ] Compare enforces two to five models; judge mode shows judged output.
- [ ] Paste a screenshot, drop a source file, and select a video. Confirm each
      appears as a removable accessible chip, remains visible on its submitted
      user message, uploads with progress, and reaches chat/agent/compare.
- [ ] Retry an attachment request and confirm the original immutable files are
      reused. Reload the view and confirm attachment bytes were not persisted.
- [ ] Reject a file over 5 MiB, more than 10 files, and a batch over 10 MiB
      before upload.
- [ ] Submit two prompts, then use Arrow Up and Arrow Down to traverse the local
      prompt history without recalling attachment bytes.

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
- [ ] In Ask for Approval, choose **Always allow in this workspace** once;
      confirm later prompts, panel changes, a VS Code reload, and restart do not
      show it again.
- [ ] Confirm final file changes and commands still require their own approval
      in Ask for Approval mode.
- [ ] Approve for me and Full Access skip their documented routine prompts.
- [ ] Full Access requires one in-workbench confirmation, then skips repeated
      routine context/generation prompts and applies validated file changes
      without another prompt.
- [ ] Every development command requires explicit in-workbench review in every
      permission mode, including command-only plans and Full Access.
- [ ] Generate/fix/tests/docs produce a strict plan.
- [ ] Send `say hi` in Agent mode and receive a normal reply with no edit error.
- [ ] Confirm a model response using `contents` creates or updates the intended
      file after normal validation and final approval.
- [ ] Invalid, absolute, traversal, secret, or oversized targets are rejected.
- [ ] File creation and edits do not open editor tabs automatically.
- [ ] **Review changes** opens every staged before/after diff on demand from
      final approval and the completed file receipt.
- [ ] Reject applies nothing.
- [ ] Approve applies all changes atomically.
- [ ] In a multi-root workspace, review changes for the second root and open the
      diff. Confirm apply remains in that root; switching roots cancels the old
      approval.
- [ ] Change an open unsaved file while its approval is visible. Confirm apply
      stops and requires a new diff review instead of overwriting the buffer.
- [ ] Confirm edits, command working directories, and command path arguments
      cannot escape through a symlink whose target is outside the workspace.
- [ ] Session undo restores create/update/delete before-state.
- [ ] Safe requested commands appear in the activity timeline, run in a visible
      task terminal, report non-zero exits, and stop on cancellation.
- [ ] Chained, destructive, privileged, or mutating Git commands are rejected.
- [ ] Inline interpreter programs and command arguments outside the workspace
      are rejected.

## Accessibility and presentation

- [ ] Grant an external output folder from More settings, request a Markdown
      deliverable at its absolute path, and verify a final-diff approval appears
      even in Full Access mode.
- [ ] Revoke that grant and verify queued writes fail. Verify external deletes,
      external commands, traversal, sensitive names, and symlink escapes fail.

- [ ] The Marketplace listing uses the cat-with-laptop icon.
- [ ] The Activity Bar and editor-title action use the three-scratch mark,
      render white on dark themes and dark on light themes, and
      remain distinct at 16–24 px.
- [ ] The route and coding activity remain a compact line until details are
      explicitly expanded.
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
- [ ] The versioned VSIX exists under `builds/` and contains no source, tests,
      maps, coverage, secrets, or nested package.
- [ ] The matching GitHub Release tag exists and contains the versioned VSIX.
