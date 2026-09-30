# ADR 0006: plugin marketplace entries carry detached Ed25519 publisher signatures

- Status: accepted
- Date: 2026-09-30
- Relates to: F081 (plugin marketplaces), `docs/THREAT_MODEL_RUNTIME_V2.md`
- Code: `src/core/plugin-signature.ts`, `plugin-signature.constants.ts`,
  `plugin-signature.types.ts`, `plugin-signature.schema.ts`,
  `plugin-signature-policy.ts`, `scripts/sign-plugin-catalog.mjs`

## Context

A marketplace catalog lists plugins with a source and a `sha256`. The hash
proves the download matches the catalog, not that the catalog entry came from
the publisher. A compromised or spoofed catalog host could list a malicious
plugin with a matching hash.

## Decision

Each catalog entry may carry a detached **Ed25519** signature by its publisher.

- **Signed text.** `canonicalEntryJson`: a JSON object with exactly `name`,
  `publisher`, `sha256`, `source`, `version`, keys in that alphabetical order,
  no whitespace, UTF-8. The order is fixed in code, not taken from input.
  `description` and `signature` are not covered. The publisher id is inside the
  signed text, so a signature cannot be replayed under another publisher.
- **Keys.** A map of publisher id to base64 Ed25519 public key (raw 32 bytes,
  or SPKI DER). Lookup uses `Object.hasOwn`, so a publisher named `__proto__`
  or `constructor` finds nothing. Verification uses `node:crypto`; no new
  dependency.
- **Verdicts.** `signed`, `unsigned`, `unknown-publisher`, `invalid`.
- **Policy** `clawAI.pluginSignaturePolicy`: `off` never looks, `warn`
  (default) lets an unverified plugin through with a visible badge, `require`
  refuses anything not `signed`. Trusted keys come from settings and
  organization policy: an organization list replaces the user's, a project list
  may only narrow.
- **Provenance.** The signer of each installed plugin is recorded in the
  profile (`plugin-provenance.json`), never in the repository.
- **Tooling.** `scripts/sign-plugin-catalog.mjs` writes the same canonical text.

## Consequences

- Default is `warn`, not `require`: existing unsigned marketplaces keep
  working, visibly. Organizations that need enforcement set `require`.
- There is no revocation list or key rotation protocol yet: rotate by
  changing the trusted key. A revoked-key feed is future work.
- A signature covers the entry, which includes the archive `sha256`, so the
  archive is transitively covered; the archive itself is still hash-checked.
- Trust in a key is a policy decision made by the user or organization, not by
  the marketplace: a catalog cannot vouch for itself.
