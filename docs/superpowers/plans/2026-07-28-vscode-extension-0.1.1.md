# ClawAI Coding Agent 0.1.1 implementation plan

1. Add failing extension tests for tolerant token parsing, origin
   normalization, model merging, onboarding, PKCE, and editor-chat behavior.
2. Add failing auth-service tests for init, approve, exchange, callback
   validation, expiry, state, PKCE, and one-time consumption.
3. Implement the auth-service browser authorization module on Redis and issue
   standard `VSCODE` sessions.
4. Add the authenticated frontend authorization page, repository, hook, nine
   locale strings, and tests.
5. Implement first-run origin setup, URI-handler browser sign-in, secure token
   exchange, model parity, editor webview panel, and stable `@clawai` Chat
   Participant.
6. Update metadata, localization, documentation, and version to 0.1.1.
7. Run scoped formatting, lint, typecheck, test, build, package audit, and
   extension-host tests.
8. Rebuild/restart only auth and frontend containers if source mounts do not
   hot reload; install the 0.1.1 VSIX and run real UI/browser/chat smoke tests.
9. Commit and push the extension repository, update the parent submodule
   pointer, regenerate knowledge/inventory artifacts after formatting, push,
   and monitor every PR gate.
