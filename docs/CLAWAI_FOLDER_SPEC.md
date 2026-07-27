# `.clawai` project folder specification

`.clawai` is optional, project-owned, and safe to commit when it contains no
secrets. **ClawAI: Initialize .clawai** creates missing files only.

```text
.clawai/
├── rules.md
├── architecture.md
├── memory.md
├── ignore
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

Workspace collection treats all of these files as normal bounded context.
Project workflows explicitly prepend rules, architecture, and memory.

The extension always excludes `.git`, dependency/output directories, `.env`,
and secret/credential/API-key-like paths. `.clawai/ignore` can only add
exclusions.

Profile-wide `global-rules.md` and `global-skills.md` are opened with their
ClawAI commands and stored in VS Code extension global storage. They apply
before project rules and are not copied into repositories.
