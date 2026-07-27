# UX guidelines

The ClawAI view is a quiet VS Code-native flight deck, not a replica of a
consumer chat page. The route rail keeps backend, route, context, token, and
plan provenance visible while the conversation remains primary.

## Principles

- Use VS Code theme variables; preserve contrast in light, dark, and
  high-contrast themes.
- Keep AUTO/manual route and provider/model attribution explicit.
- Make busy, disconnected, error, quota, and cancellation states visible.
- Render context receipts and edit previews before asking users to trust an
  operation.
- Keep destructive or modifying choices modal and explicit.
- Preserve focus outlines, semantic landmarks, labels, live regions, and a skip
  link.
- Support keyboard-only operation, narrow sidebars, zoom, and RTL layouts.
- Render untrusted strings as text.

The webview collapses the detailed route rail at narrow widths without hiding
the active route summary. Model comparison appears only in compare/judge mode
and enforces two to five selections.

New visible strings must use `vscode.l10n.t` or package NLS and be regenerated
for all supported locales.
