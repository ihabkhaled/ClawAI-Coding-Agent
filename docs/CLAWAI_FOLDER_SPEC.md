# `.clawai` project folder specification

`.clawai` is optional, project-owned, and safe to commit when it contains no
secrets. **ClawAI: Initialize .clawai** creates missing files only.

```text
.clawai/
├── rules.md
├── architecture.md
├── memory.md
├── ignore
├── policies/
│   └── policy.json
├── context/
│   ├── product.md
│   ├── api.md
│   ├── database.md
│   └── testing.md
├── skills/
│   ├── typescript.md
│   ├── react.md
│   ├── node.md
│   └── nestjs.md
└── prompts/
    ├── code-review.md
    └── implementation-plan.md
```

- `rules.md`: non-negotiable repository rules.
- `architecture.md`: boundaries and dependency direction.
- `memory.md`: durable, non-secret lessons.
- `context/*`: product, API, data, and gate facts.
- `skills/*`: stack-specific implementation guidance.
- `prompts/*`: reusable review and planning instructions.
- `ignore`: one glob per line; blank lines and `#` comments are ignored.
- `policies/policy.json`: the project permission policy. See below.

## `policies/policy.json`

Every field narrows what the agent may do; none widens it.

```json
{
  "deniedEffects": ["publication"],
  "maximumRisk": "R2",
  "requireApproval": ["local-mutation"],
  "rules": [
    { "pathGlob": "infra/*", "outcome": "ask", "reason": "infra changes are reviewed" },
    { "commandGlob": "git push*", "outcome": "deny", "reason": "pushes are manual here" },
    { "tool": "workspace.database", "outcome": "deny", "reason": "no database access" }
  ]
}
```

A rule matches on any of `tool`, `operation`, `pathGlob` and `commandGlob`, and
must name at least one — a rule that matches nothing in particular matches
everything, which is never what the author meant. `pathGlob` is tested against
the paths a call actually names, and `commandGlob` against the executable and
its arguments joined. Patterns are `*` globs, not regular expressions.

Two properties are deliberate and worth relying on:

- **`outcome` is `ask` or `deny`, never `allow`.** This file lives inside the
  workspace, and workspace content is untrusted. A repository that could write
  `allow` would be a repository that grants itself permissions by being cloned.
  Tightening is safe from an untrusted source because the worst a hostile rule
  achieves is refusing to do something.
- **Order does not matter.** When rules disagree, a `deny` wins over an `ask`,
  so a hand-written file can be read without simulating the list.

Rules are consulted after the immutable safety rails, so no rule can loosen a
workspace-trust denial or the elevation, production and destructive rails.
Patterns are globs rather than regular expressions for the same reason: an
expression from an untrusted file is a denial-of-service waiting for the right
input.

Workspace collection treats all of these files as normal bounded context.
Project workflows explicitly prepend rules, architecture, and memory.

The extension always excludes `.git`, dependency/output directories, `.env`,
and secret/credential/API-key-like paths. `.clawai/ignore` can only add
exclusions.

Profile-wide `global-rules.md` and `global-skills.md` are opened with their
ClawAI commands and stored in VS Code extension global storage. They apply
before project rules and are not copied into repositories.
