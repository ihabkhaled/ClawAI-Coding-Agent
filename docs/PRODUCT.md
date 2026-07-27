# Product definition

## Problem

Developers using ClawAI need editor-native access to backend models and routing
without duplicating credentials, policy, usage, or orchestration inside VS
Code. They also need coding-agent edits that remain reviewable and reversible.

## Users

- developers running ClawAI locally;
- teams connected to a hosted ClawAI deployment;
- administrators validating entitlement and routing behavior;
- privacy-conscious users who require explicit context and edit boundaries.

## Success criteria

- a user can connect, see entitled models and quota, and receive attributed
  streaming output;
- AUTO and manual routing match backend policy;
- context receipts explain every included and excluded file;
- no file changes without trust, validation, preview, and explicit approval;
- activation stays responsive and release gates produce a reproducible VSIX;
- keyboard, theme, narrow-view, RTL, and 13-locale surfaces remain usable.

## Non-goals

- storing provider API keys in VS Code;
- implementing a second router, entitlement engine, or conversation database;
- autonomous terminal, Git commit, push, deployment, or shell execution;
- silently applying generated edits;
- replacing the full ClawAI web administration experience.
