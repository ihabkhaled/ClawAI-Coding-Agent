# Settings Popover Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings prominent, give every enabled interactive control a pointer cursor, and dismiss the settings popover on outside interaction or Escape.

**Architecture:** Retain the existing semantic `<details>` popover and add small controller-level dismissal listeners in `media/chat.js`. Centralize enabled-control cursor behavior and strengthen only the settings trigger styling in `media/chat.css`.

**Tech Stack:** VS Code webview HTML/CSS/JavaScript, Playwright, Vitest, npm, VSIX packaging.

## Global Constraints

- Keep Send as the only solid primary action.
- Preserve native keyboard activation, focus-visible styling, narrow layout, and RTL behavior.
- Keep disabled controls on the default cursor.
- Do not change backend contracts, persisted settings, or permission behavior.
- Ship as version 0.11.1 with changelog, locales, rebuilt VSIX, installation, and release verification.

---

### Task 1: Settings dismissal and interactive cursors

**Files:**

- Modify: `tests/playwright/signal-desk.e2e.ts`
- Modify: `media/chat.js`
- Modify: `media/chat.css`

**Interfaces:**

- Consumes: Existing `#moreSettings`, `#moreSettingsSummary`, `.secondary-controls`, and composer controls.
- Produces: Outside-pointer dismissal, Escape dismissal with focus restoration, and consistent enabled-control cursor styling.

- [ ] **Step 1: Write failing browser regressions**

Add Playwright coverage that opens `#moreSettings`, clicks `#permissionMode`
without closing it, clicks `#prompt` and expects the `open` attribute to be
removed, then reopens it, presses Escape, expects it closed, and expects
`#moreSettingsSummary` to be focused. Assert pointer cursors on the enabled
settings trigger, Send button, model select, and prompt suggestion; assert a
disabled button does not expose a pointer cursor.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npx playwright test tests/playwright/signal-desk.e2e.ts
```

Expected: dismissal and cursor assertions fail against 0.11.0.

- [ ] **Step 3: Implement minimal behavior and styling**

Add a document `pointerdown` listener that closes `elements.moreSettings` only
when it is open and the event target is outside it. Add a document `keydown`
listener that handles Escape, closes the popover, and focuses
`#moreSettingsSummary`. Update CSS so enabled interactive controls use
`cursor: pointer`, disabled controls use `cursor: default`, and the settings
summary uses an accent outline, tinted background, stronger text, and a
CSS-rendered gear mark while retaining the narrow icon-only layout.

- [ ] **Step 4: Verify targeted tests pass**

Run:

```bash
npx playwright test tests/playwright/signal-desk.e2e.ts
```

Expected: all Signal Desk tests pass.

### Task 2: Release 0.11.1

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Regenerate: `package.nls.*.json`
- Create: `builds/clawai-coding-agent-0.11.1.vsix`

**Interfaces:**

- Consumes: The verified webview patch.
- Produces: Installable and releasable ClawAI Coding Agent 0.11.1.

- [ ] **Step 1: Bump and document**

Run `npm version 0.11.1 --no-git-tag-version`, then add a user-facing 0.11.1
changelog entry describing settings prominence, pointer feedback, and reliable
popover dismissal.

- [ ] **Step 2: Run required gates**

Run:

```bash
npm run l10n:build
npm run format
npm run check
npm run test:playwright
npm run test:host
npm run package
npm audit --omit=dev --audit-level=high
```

Expected: every command succeeds and the versioned VSIX is generated.

- [ ] **Step 3: Install and verify**

Run:

```bash
code --install-extension builds/clawai-coding-agent-0.11.1.vsix --force
code --list-extensions --show-versions
```

Expected: `clawai.clawai-coding-agent@0.11.1`.

- [ ] **Step 4: Commit, push, and verify release**

Commit the coherent release, push extension `main`, verify extension CI and
Release reach successful terminal status, and verify the v0.11.1 VSIX asset.

### Task 3: Update parent repository

**Files:**

- Modify: parent `apps/claw-coding-agent` submodule pointer.

**Interfaces:**

- Consumes: Released extension commit.
- Produces: Parent branch pointing at v0.11.1.

- [ ] **Step 1: Regenerate parent artifacts and verify**

Run `npm run knowledge:build`, `npm run audit`, `npm run knowledge:verify`, and
`npm run audit:check` from the parent repository.

- [ ] **Step 2: Commit, push, and monitor**

Commit the submodule pointer, push `feat/vscode-extension-god-mode`, and verify
the parent CI, Lighthouse, and ai-native-os workflows reach successful terminal
status.
