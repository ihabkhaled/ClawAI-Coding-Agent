# Migrating to 0.40.0

## Supported upgrade sources

The release suite covers clean install plus migrations from 0.17.0, 0.20.0, 0.31.0, and 0.39.0. Existing connection profiles, sessions, conversations, external-output grants, and V1 compatibility remain intact. Runtime V2 journals use a new encrypted store and do not reinterpret legacy conversation history as executable authority.

## Behavioral changes

- Runtime V2 is selected only after authenticated protocol negotiation and a compatible capability manifest.
- Tools are target-aware, schema-validated, bounded, cancellable, redacted, and policy evaluated.
- Attachments and research retain the legacy payload path until their canonical Runtime V2 payload negotiation is available; this prevents silent data loss during migration.
- Browser, container, database, service, journal, and evidence capabilities are advertised only when the extension host can provide them.
- Stale account/workspace/target/policy epochs invalidate pending invocations and grants.

## Rollback

1. Cancel active runs and export any evidence needed for audit.
2. Uninstall 0.40.0, then install the previously retained VSIX.
3. Do not copy encrypted journal files between VS Code profiles; their encryption key is profile-bound.
4. Older versions ignore the new Runtime V2 store. They continue using compatible conversations and connection settings.
5. Revoke external-output grants and remove browser artifacts/journals from Runtime Studio before uninstall when local retention is not desired.

Rollback does not reverse file changes, commits, database mutations, container effects, or publication already approved and completed. Use the corresponding receipts and repository/database recovery procedures.
