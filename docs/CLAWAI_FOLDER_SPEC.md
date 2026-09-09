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
├── agents/
│   └── agents.json
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
- `agents/agents.json`: named sub-agent presets. See below.

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

## `agents/agents.json`

Named presets a sub-agent graph can reference by name instead of restating an
identity on every fork. Each entry adds instructions; none of them can widen
what a forked task is already allowed to do.

```json
[
  {
    "name": "strict-reviewer",
    "description": "Reviews for correctness and security with no tolerance for scope creep.",
    "systemPrompt": "You are a strict reviewer. Flag every unverified claim and reject scope creep."
  }
]
```

A sub-agent task still declares its own `tools`, `modelPolicy`, `budget`, and
`riskCeiling` on every fork — those never come from a definition. Naming a
`definitionName` only prepends the matching preset's `systemPrompt` and
`description` to that task's prompt; an unresolved name is silently ignored,
never guessed at. `name` must be lowercase, start with a letter, and contain
only letters, digits, and hyphens; names must be unique within the file.

This file is workspace content, trusted the same way `rules.md`,
`architecture.md`, and `memory.md` already are — a definition's `systemPrompt`
is instructions, not a grant, so it carries no more authority than any other
project guidance a sub-agent already reads.

The extension always excludes `.git`, dependency/output directories, `.env`,
and secret/credential/API-key-like paths. `.clawai/ignore` can only add
exclusions.

Profile-wide `global-rules.md` and `global-skills.md` are opened with their
ClawAI commands and stored in VS Code extension global storage. They apply
before project rules and are not copied into repositories.
