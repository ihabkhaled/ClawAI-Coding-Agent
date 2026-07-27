# Threat model and controls

## Protected assets

- ClawAI access/refresh tokens and account passwords;
- source code and proprietary workspace context;
- provider/model entitlement and quota data;
- file-system integrity;
- backend and webview trust boundaries.

## Threats

### Credential disclosure

Passwords are transient. Tokens use `SecretStorage`. URLs reject embedded
credentials. Non-local HTTP is rejected. Logger and backend errors redact
bearers, query parameters, secret keys, and assignment syntax.

### Prompt injection and context exfiltration

Workspace files are labeled as untrusted data. Collection is opt-in through a
command/context mode, bounded, and receipt-producing. `.git`, dependencies,
outputs, `.env`, and credential-like paths are denied. User ignore rules can
add exclusions but cannot remove built-in denials.

### Malicious model edits

The edit plan is strict and bounded to 50 files and one megabyte per file.
Absolute paths, traversal, VCS metadata, environment files, and credential-like
targets are rejected. Users inspect diffs and approve modally. Trust is checked
both before preview and immediately before atomic apply.

### Webview injection

Inbound messages use a discriminated Zod union with length and cardinality
limits. CSP uses `default-src 'none'`, a fresh cryptographic nonce, and
extension-local assets. Dynamic content is rendered with DOM text nodes and
`textContent`; it is never assigned to `innerHTML`.

### Backend compromise or drift

Every response is parsed through a narrow runtime schema. Error bodies are
bounded and redacted. Requests have timeouts and cancellation. The client does
not execute backend-provided shell commands.

## Residual risks

Approved generated code can still be incorrect. Users must review diffs and run
their repository gates. Workspace content sent to a configured hosted backend
leaves the local machine; the context receipt makes that set visible, but the
backend operator remains part of the trust model.
