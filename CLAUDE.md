# ClawAI Coding Agent — canonical engineering policy

The extension is a thin, security-sensitive client of the ClawAI platform. The
backend owns authentication, session rotation, entitlements, quota, routing,
provider credentials, inference, persistence, and audit history. The extension
owns editor UX, bounded context assembly, response rendering, and safe edit
application.

## Dependency direction

`extension.ts` composes adapters and services. Views and VS Code adapters call
application services. Application services depend on explicit ports and pure
core modules. The backend client is the only HTTP boundary. Do not import code
from the parent ClawAI monorepo: this repository must build and release alone.

## Non-negotiable behavior

Authentication accepts a password only in a masked input and immediately
submits it. Only validated token pairs may enter `SecretStorage`. Hosted
backends require HTTPS. A 401 triggers one coordinated refresh and one retry.

Workspace context is untrusted and bounded. Always deny secrets even if a user
removes an ignore rule. Every modifying workflow returns a strict edit plan,
stages reviewable diffs, follows the selected permission mode, rechecks trust,
and applies one atomic workspace edit. Manual and Edit Automatically modes
require final-diff approval; Full Access may apply the staged diff without an
extra prompt but never bypasses trust, secret, path, or command safety.

Keep webviews under strict CSP with fresh nonces, local resources, text-only
untrusted rendering, validated message schemas, keyboard access, theme colors,
and RTL-compatible layout.

## Delivery checklist

- implementation and failure-path tests;
- 85% or better branch/function/line/statement coverage for pure logic;
- real VS Code activation test;
- all 13 package/runtime locale bundles regenerated;
- formatting, ESLint, strict TypeScript, bundle, package audit, runtime
  dependency audit, and VSIX packaging green;
- docs and changelog updated for user-visible or contract changes.

Every publishable change must apply `skills/version-every-change/SKILL.md`,
advance SemVer, rebuild the versioned VSIX in `builds/`, and publish a matching
GitHub release. One unpublished coherent batch receives one bump.
