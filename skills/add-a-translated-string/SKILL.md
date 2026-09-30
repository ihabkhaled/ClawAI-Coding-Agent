---
name: add-a-translated-string
description: Add a user-facing string (runtime or package.nls) with real translations in all 12 locales. Use for any new text shown to users.
---

# Add a translated string

Locales: ar de es fa fr hi it ja pt ru th zh (English is the source).

## Steps

1. **Source string.** Runtime: `vscode.l10n.t('Text {0}', arg)` in `src/`;
   `scripts/generate-locales.mjs` scans `src/` for these calls. Manifest text:
   add `"key": "English"` to `package.nls.json`.
2. **Translations.** Add `scripts/<feature>-translations.mjs` exporting
   `<feature>Translations = { ar: {'English': '...'}, ... }` for all 12 locales
   (copy the shape of `scripts/permission-mode-translations.mjs`). Real
   translations only: no English copies; keep `{0}` placeholders.
3. **Wire.** Import it in `scripts/generate-locales.mjs` and add
   `<feature>Translations[locale][message] ??` to the chain in `translate()`.
   An unwired entry silently falls back to English.
4. **Generate.** `npm run l10n:build` rewrites `l10n/bundle.l10n*.json` and
   `package.nls.*.json`. Stage them.
5. **Baseline.** `l10n/untranslated-baseline.json` lists legacy strings still equal
   to English. Do not add new strings to it.
   `tests/unit/localization-coverage.test.ts` fails on new untranslated strings, on
   baseline entries that are now translated, and on entries for removed messages.
   Add one only when a real translation is genuinely identical (brand names).

## Commands

```bash
npm run l10n:build && npm run l10n:verify
npx vitest run tests/unit/localization-coverage.test.ts
```

## Pitfalls

- `l10n:verify` = regenerate + `git diff --exit-code`: unstaged generator output fails it.
- The translation key IS the English text; any edit to the English string orphans its translations.
- Webview text must arrive through the message channel, not be hardcoded in `media/`.
