# Localization and accessibility

> Every visible string is translated into 12 languages besides English, and the panel works by keyboard, screen reader, narrow width, right-to-left and high contrast.

## Business why

- The product success criteria require "keyboard, theme, narrow-view, RTL, and 13-locale surfaces remain usable" ([PRODUCT](../../PRODUCT.md)).
- The Marketplace listing and the web platform serve a multi-language audience; the docs list the locales (Arabic, German, Spanish, Persian, French, Hindi, Italian, Japanese, Portuguese, Russian, Thai, Chinese) but give no market data. Which markets matter: _Unknown - ask the owner and record the answer._
- Screen reader support is row F070 of the parity program ([audit F056-F087](../../parity/AUDIT_F056_F087.md)).

## Product why

- Problem: users who read right to left or use a screen reader, keyboard only, a narrow sidebar or a forced high-contrast theme must get the same product.
- Who: all users; accessibility users specifically.
- How it shows up:
  - Command titles, settings, walkthrough and webview text come in 13 locale files (`l10n/bundle.l10n.*.json`, `package.nls.*.json`).
  - Alt+Up and Alt+Down step between conversation turns; each turn is a labelled, focusable `article` carrying who spoke and its position; changes are announced through a live region.
  - 11 keyboard shortcuts with a macOS equivalent each ([audit F084](../../parity/AUDIT_F056_F087.md)).
  - Compare cards announce phase changes without reading the answer word by word; focus never leaves the box the user types in (1.90.0).
  - Larger tap targets and full keyboard support for new chat controls, checked in light, dark and RTL layouts (1.84.0).
  - Focus view for reading (`clawAI.viewDensity`).
- Acceptance found in the docs ([UX_GUIDELINES](../../UX_GUIDELINES.md)): theme variables, contrast in light, dark and high contrast; focus outlines, landmarks, labels, live regions and a skip link; keyboard-only, narrow, zoom and RTL; untrusted strings rendered as text.

## How it works

- Rule: every user-facing string goes through `vscode.l10n.t` or `package.nls.json` and is translated for all 12 non-English locales ([RULES](../../RULES.md), rule 11).
- Generation: `npm run l10n:build` (`scripts/generate-locales.mjs`) regenerates `l10n/` and `package.nls*.json`. Per-feature translation tables live in `scripts/*-translations.mjs` (many files, such as `permission-mode-translations.mjs`). A brand name the same in all 13 locales must be a plain constant, not `l10n.t` ([TESTING](../../TESTING.md)).
- Gates: `npm run l10n:verify` regenerates and runs `git diff --exit-code` so the generated files must be staged; `tests/unit/localization-coverage.test.ts` allows no new English fallbacks; `l10n/untranslated-baseline.json` "may only shrink" (307 entries now). Translations fill gaps rather than overriding existing ones (2026-09-10 fix).
- Accessibility code: `src/core/turn-navigation.ts`, `media/chat.js`, `src/webview/chat-markup.ts`, `src/core/view-density.ts`. Both ends of Alt+Up and Alt+Down stop rather than wrap, "because wrapping teleports a reader from the newest message to the oldest" (audit F070).
- Webview security that shares the surface: strict CSP with a nonce, text nodes only.
- The sign-in return page (browser) is translated in all 13 languages (1.47.0).

## Decisions

- Translate before ship: "new text must now be translated before it can ship" (1.6.0). Alternative: English fallback; the baseline file tracks leftover English and may only shrink.
- Wrapping navigation rejected for turn stepping (above).
- 12 versus 13 locales: package docs say "12 locales" (non-English) and "13-locale" (with English); both refer to the same set.

## History

- 2026-09-10: Alt+Up and Alt+Down turn navigation and labelled turns (1.4.0, F070); first twenty strings translated and the translation ratchet added (1.6.0); fix so new translations stop replacing existing ones, e.g. Chinese and Thai (1.7.1); local gate for localization.
- 2026-09-15: surface inventory generated; commands, bindings, menus and views checked, "every title is translated rather than English" (1.57.0).
- 2026-09-30: more menus and settings translated in all 12 languages (1.85.0); first-run walkthrough added.
- 2026-10-01: Compare card status words translated; they were English in every other language (1.90.0).
- 2026-11-02: the "run stopped responding" message translated in 12 locales (1.111.0).
- Known partial: the repeat-stop message and the headless plan or credit message are English only (1.102.0, 1.110.0).

## Tests and evidence

- Unit: `localization-coverage.test.ts`, `localization-quality.test.ts`, `built-in-skill-l10n.test.ts`, `tests/unit/contributed-commands.test.ts` (surface counts).
- Playwright (`tests/playwright/`): `device-matrix-layout.e2e.ts` runs each viewport in LTR and RTL and in themes, asserting no overflow, reachable and sized targets, and contrast of at least 4.5; `device-matrix-keyboard.e2e.ts`; `turn-navigation.e2e.ts`; `compare-live.e2e.ts` at 320, 400 and 768 pixels, LTR and RTL, dark and light with contrast and overflow checks (see [TESTING](../../TESTING.md)).
- Package audit: `npm run package:audit` asserts all locale files exist ([RULES](../../RULES.md), rule 13).
- Honest limit: no recorded test with a real screen reader appears in the docs read for this page.

## Known gaps and risks

- 307 strings remain untranslated in the baseline.
- Some runtime messages are English only (see History).
- A localization gap in the docs: "`npm run check` does not cover" l10n freshness in one case, recorded 2026-09-09 ("record the l10n freshness gap npm run check doesn't cover"; commit "docs(parity): record the l10n freshness gap npm run check doesn't cover").
- No real assistive-technology run is recorded.

## Open questions

- _Unknown - ask the owner and record the answer._ Which languages are next, and who reviews translation quality (human or machine)?
- _Unknown - ask the owner and record the answer._ Is a WCAG level the target?
- _Unknown - ask the owner and record the answer._ Were the translations machine-made or reviewed?
