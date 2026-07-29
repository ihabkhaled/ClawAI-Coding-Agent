# ClawAI Coding Agent 0.9.0 implementation plan

1. Reproduce stale model/failure replay on a reused thread and lock the failure
   with backend controller/service and extension transport tests.
2. Snapshot the selected model per request and add prompt-history keyboard tests.
3. Add attachment schemas and tests before upload, transport, agent, and webview
   implementation.
4. Support pasted, dropped, and selected images, videos, documents, and source
   files with accessible chips, immutable request receipts, progress, and Retry.
5. Add backend video signature validation, binary-safe context handling, and
   capability-aware AUTO/manual routing tests.
6. Make Full Access auto-apply safe file changes while keeping commands and hard
   workspace boundaries explicit and tested.
7. Serialize multi-window session mutation/refresh and prove stale authorization,
   logout, endpoint, and lifecycle work cannot restore old credentials.
8. Re-run workspace transaction tests for roots, symlinks, dirty buffers,
   cancellation, atomic apply, and undo.
9. Localize all new runtime copy, update security/UAT/release documentation, and
   package version 0.9.0 under `builds/`.
10. Run every release gate, install the exact VSIX, commit and push `main`, create
    GitHub release `v0.9.0`, attach the VSIX, and update the parent submodule.
