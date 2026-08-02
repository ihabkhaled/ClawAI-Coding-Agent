# Agent Cockpit design

## Direction

The cockpit is a compact orchestration instrument for developers, not a generic chat surface. It uses VS Code theme colors as immutable accessibility inputs and spends its visual emphasis on a single signature element: the ordered **signal spine** that connects model output, tools, approvals, evidence, and final receipts.

The user already approved the direction through the supplied screenshots and the instruction to proceed without further questions. This document records the design before implementation; it will be committed with the consolidated 0.40.0 release rather than as an intermediate release.

## Tokens

- Signal cyan: `var(--vscode-focusBorder)` for active execution and focus.
- Claw coral: `#e06c5f` mixed with theme surfaces for brand warmth.
- Verified green: `var(--vscode-testing-iconPassed)` for proven success only.
- Warning amber: `var(--vscode-editorWarning-foreground)` for approval and risk.
- Failure red: `var(--vscode-testing-iconFailed)` for terminal failures.
- Surfaces, foreground, borders, and high-contrast behavior remain native VS Code tokens.

Typography uses `Segoe UI Variable Text` for interface copy and the configured VS Code editor font for tokens, hashes, commands, durations, and receipts. This makes prose readable while operational metadata feels native to a coding tool.

## Layout

```text
┌ workspace / conversation ───────── actions ┐
├ current model ─ token budget ─ active mode ┤
│ route · context · behavior · rails         │
├ ordered signal spine ──────────────────────┤
│ model → tool → approval → evidence → final │
│       task/process/agent detail cards      │
├ composer, always usable during execution ──┤
│ attach · model · run · settings · send     │
└ queue / steering / pause / stop ───────────┘
```

The top bar names the current model rather than repeating connection mechanics. Token and budget information receives a vivid bounded meter. Detailed settings stay one click away and close on outside click or Escape. Independent editor sessions retain independent timelines.

## Timeline and cards

The canonical runtime reducer is the only source for Runtime V2 cards. Each run is keyed by run ID; each invocation is keyed by invocation ID, so replayed events update instead of duplicate. Cards default to a one-line status and expand to sanitized target, operation, duration, bytes, truncation, redaction, approval, and receipt details. Tool families receive recognizable labels without inventing phases.

Dangerous operations use warning styling but never imply that autonomous mode disables trust, containment, secret denial, or policy epochs. Hidden reasoning is never rendered. Only deliberate concise summaries from public runtime events appear.

## Interaction and accessibility

The composer stays enabled while runs execute. A send at capacity becomes a queued future turn. Steering, pause, and stop remain distinct actions. All controls use pointer cursors when enabled, visible focus, real buttons, accessible names, live-region status, logical CSS properties for RTL, and reduced-motion fallbacks. Dense content scrolls inside bounded panels rather than stretching the host layout.

## Error and continuation behavior

Errors state the failed phase and next safe action. Context continuation preserves run ID, tasks, policy epochs, budget, and an inspectable compacted summary. Copy/export routes through redaction and requires approval before sensitive evidence leaves its run.

## Verification at 0.40.0

The final pass covers dark, light, high contrast, RTL, sidebar/editor widths, keyboard traversal, live regions, reduced motion, parallel sessions, event ordering, duplicate suppression, high-volume rendering, approvals, failures, steering, continuation, and memory behavior.
