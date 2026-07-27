# Security policy

## Supported versions

Security fixes are provided for the latest published minor version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting for this repository. Include affected versions,
reproduction steps, impact, and any safe proof of concept. Do not include real
credentials, provider keys, tokens, user content, or production data.

Maintainers will acknowledge a complete report as soon as practical, validate
the issue, coordinate a fix, and publish an advisory when users can safely
upgrade.

## Security invariants

- Passwords are never persisted.
- Access and refresh tokens live only in VS Code `SecretStorage`.
- Non-loopback backends require HTTPS.
- No secret-bearing settings are contributed.
- Logs and backend error text are redacted.
- Workspace content is treated as untrusted data in model prompts.
- Secret-like paths, `.env`, `.git`, dependencies, outputs, and ignored paths
  are excluded from context.
- Workspace Trust gates collection and modification.
- Every edit is path-validated, previewed, explicitly approved, trust-checked,
  and atomically applied.
- Webview messages are allowlisted and validated; its CSP denies everything by
  default and allows only nonce-bound local scripts.
- Backend responses are runtime-validated before use.

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model.
