---
name: add-a-command-or-view
description: Contribute a new VS Code command, view, or setting in the ClawAI Coding Agent. Use when package.json contributes changes.
---

# Add a command, view or setting

## Steps

1. **Manifest.** `package.json` `contributes.commands` (id `clawAI.<name>`,
   `title: "%command.<name>%"`, `category: "ClawAI"`), plus `menus`,
   `keybindings`, `views` or `configuration` as needed.
2. **NLS.** Add every `%key%` to `package.nls.json`, then follow
   `skills/add-a-translated-string` so the 12 `package.nls.<locale>.json` are real.
3. **Register.** Call `vscode.commands.registerCommand('clawAI.<name>', ...)` in a
   `src/services/register-*.ts` file (or view provider). `package:audit` counts a
   command only if its id appears in a file that calls `registerCommand`. Logic lives
   in a service, not the registration file.
4. **Settings** are read only through `src/services/configuration-service.ts`
   (never `vscode.workspace.getConfiguration` elsewhere). No secret-bearing settings.
   `tests/unit/contributed-settings.test.ts` checks the manifest.
5. **Counts.** Bump `commands.length` in `tests/unit/contributed-commands.test.ts`,
   run `npm run inventory:surface`, and bump `rows.length` in
   `tests/unit/surface-inventory.test.ts` to match.
6. **Tests.** Handler success and failure; trust/permission checks if it touches the workspace.
7. **Docs.** README/CHANGELOG only after the call path exists.

## Commands

```bash
npm run l10n:build
npm run inventory:surface
npx vitest run tests/unit/contributed-commands.test.ts tests/unit/contributed-settings.test.ts tests/unit/surface-inventory.test.ts
npm run package:audit
```

## Pitfalls

- `inventory:verify` fails if a manifest entry has no row; regenerate, do not hand-edit.
- Existing rows keep Status/Evidence; new rows start NOT RUN. Record real evidence only.
- `l10n:verify` diffs against git: stage the regenerated files.
