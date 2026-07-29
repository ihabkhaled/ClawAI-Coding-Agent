# Threat model and controls

## Protected assets

- ClawAI access/refresh tokens and account passwords;
- source code and proprietary workspace context;
- provider/model entitlement and quota data;
- file-system integrity;
- backend and webview trust boundaries.

## Threats

### Credential disclosure

Passwords stay in the ClawAI web app. Browser authorization uses PKCE, exact
state validation, and a one-shot `127.0.0.1` callback. Tokens use
`SecretStorage`. URLs reject embedded credentials. Non-local HTTP is rejected.
Logger and backend errors redact bearers, query parameters, secret keys, and
assignment syntax.

### Prompt injection and context exfiltration

Workspace files are labeled as untrusted data. Collection is opt-in through a
command/context mode, bounded, and receipt-producing. `.git`, dependencies,
outputs, `.env`, and credential-like paths are denied. User ignore rules can
add exclusions but cannot remove built-in denials.

### Malicious model edits

The edit plan is strict and bounded to 50 files and one megabyte per file.
Absolute paths, traversal, VCS metadata, environment files, and credential-like
targets are rejected. Approvals are rendered inside the workbench. Trust is
checked both before preview and immediately before atomic apply.

In Manual mode, approving routine workspace access once stores only a boolean
grant in VS Code's workspace-scoped state. It covers non-sensitive context
collection and proposal generation for that workspace across reloads. It does
not authorize final file changes or commands, and it never weakens Workspace
Trust, secret exclusions, path validation, command validation, or atomic apply.

### Malicious model commands

Command plans are optional, bounded, and executed only after approved file
changes. Executables use a development-tool allowlist. Shell chaining,
redirection, substitution, environment expansion, privilege tools, destructive
utilities, and mutating Git commands are rejected. Working directories must be
safe relative workspace paths. Commands run in a visible VS Code task terminal
and are cancellable.

### Webview injection

Inbound messages use a discriminated Zod union with length and cardinality
limits. CSP uses `default-src 'none'`, a fresh cryptographic nonce, and
extension-local assets. Dynamic content is rendered with DOM text nodes and
`textContent`; it is never assigned to `innerHTML`.

### Backend compromise or drift

Every response is parsed through a narrow runtime schema. Error bodies are
bounded and redacted. Requests have timeouts and cancellation. Proposed
commands are treated as untrusted until strict local validation and the active
permission policy allow them.

## Residual risks

Approved generated code can still be incorrect. Users must review diffs and run
their repository gates. Workspace content sent to a configured hosted backend
leaves the local machine; the context receipt makes that set visible, but the
backend operator remains part of the trust model.
