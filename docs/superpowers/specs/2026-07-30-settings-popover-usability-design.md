# Settings popover usability design

## Goal

Make every enabled interactive control communicate clickability, make the
composer Settings action easy to discover, and dismiss its popover when the
user clicks elsewhere or presses Escape.

## Interaction design

- Keep the secondary composer controls inside the existing settings popover so
  the prompt area remains compact.
- Present the trigger as an accent-outlined Settings button with a settings icon
  and visible text at standard widths.
- Preserve the compact icon-only treatment at narrow widths, with an accessible
  name and tooltip.
- Close the popover when a pointer interaction occurs outside the settings
  trigger and panel.
- Close the popover when Escape is pressed and return focus to the trigger.
- Keep the popover open while interacting with any control inside it.
- Preserve native keyboard activation and the existing focus-visible treatment.

## Cursor behavior

Enabled buttons, selects, summaries, and elements explicitly exposed as
clickable controls use `cursor: pointer`. Disabled form controls use the default
cursor and retain their reduced-opacity treatment.

## Visual treatment

Settings uses the existing ClawAI accent as a restrained outline and soft-tint
surface. Send remains the only solid primary action. The trigger must have
stronger foreground contrast and weight than the previous muted secondary
style, without competing with Send.

## Implementation boundaries

- Keep the existing `<details>` semantics and IDs to avoid unnecessary markup
  and localization churn.
- Add dismissal behavior in the webview controller using document-level pointer
  and keyboard listeners.
- Scope styling changes to interactive cursor rules and the settings trigger.
- Do not change backend contracts, persisted configuration, or permission
  behavior.

## Verification

- A Playwright regression test opens Settings, clicks inside it, confirms it
  remains open, then clicks outside and confirms it closes.
- A Playwright regression test verifies Escape closes the popover and restores
  focus to the trigger.
- UI assertions verify enabled interactive controls expose a pointer cursor,
  while disabled controls do not.
- Visual snapshots cover standard and narrow composer layouts.
- Existing unit, Playwright, extension-host, localization, packaging, and audit
  gates remain green.

## Release

Ship the coherent patch as version 0.11.1 with changelog, rebuilt VSIX, GitHub
release, and the parent repository submodule pointer update.
