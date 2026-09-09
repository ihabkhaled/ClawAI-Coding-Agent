# ADR 0001: a `vscode://` handler for navigation only, never for authorization

- Status: accepted, and reversible — the handler can be removed without
  affecting anything else, because nothing depends on it to function
- Date: 2026-09-09
- Supersedes: nothing. Narrows the blanket absence recorded by
  `CHANGELOG.md:1470` and asserted by `tests/extension-host/index.cjs`

## Context

The parity pack asks for a VS Code URI handler (F072) and deep links (F073).
The audit classified both MISSING. They are not missing; they are absent on
purpose.

`CHANGELOG.md:1470` records replacing a custom URI callback with a
state-validated one-shot loopback authorization callback, and the extension-host
test asserts that no `onUri` activation event survives:

```js
assert.ok(
  !extension.packageJSON.activationEvents.includes('onUri'),
  'loopback browser authorization does not expose a custom URI callback',
);
```

Implementing F072 as written would delete that assertion, which is why this
decision is written down before any code. As it turns out the assertion
survives — see Consequences — but that was not knowable in advance.

## The risk that removal was about

A `vscode://` link is triggerable by any web page the user visits. For an
**authorization callback** that is disqualifying, for two independent reasons:

1. The authorization code travels through a channel the extension does not
   control, and any installed extension can register a handler for the same
   URI scheme. A code delivered that way can be intercepted.
2. There is no way to bind the callback to the request that started it beyond
   a state value, and no way to prove the responding handler is the one that
   asked.

Loopback with PKCE has neither problem: the listener is bound to `127.0.0.1` on
a random port, exists for one callback, and is closed immediately.
`docs/AUTHENTICATION.md` describes the full rule set. **That decision stands
permanently and is not revisited here.**

## Decision

A URI handler is admissible for **navigation only**, under three constraints
that keep it away from the risk above:

1. **No credential, code, token or secret may pass through it, in either
   direction.** Authorization keeps using the loopback callback.
2. **No prompt text may come from the URI.** Accepting text would make any web
   page able to seed the composer of a coding agent, and a user who then presses
   send has been made the delivery mechanism for someone else's instruction.
   Refusing text removes the injection vector rather than mitigating it.
3. **No side effect may follow from the URI alone.** It opens a view or a
   conversation. It never sends, runs, edits, approves, or connects.

The accepted surface is exactly:

- `vscode://clawai.clawai-coding-agent/open` — open the ClawAI view.
- `vscode://clawai.clawai-coding-agent/session?id=<uuid>` — open one existing
  conversation, where the id must parse as a UUID and must already belong to
  the signed-in account.

Anything else is ignored. An unknown path is not an error worth showing: an
error dialog raised by a link the user did not knowingly click is itself a
nuisance a page could trigger repeatedly.

## Consequences

- **The existing host-test assertion is unchanged and still passes.** No
  `onUri` activation event is added: activation is already `onStartupFinished`,
  so the handler is registered in every window regardless, and VS Code holds a
  pending URI until a handler exists. The assertion was about the authorization
  callback, and there still is not one.
- The ClawAI web app can link into an open conversation, which is the concrete
  motivation for F073.
- A page can make VS Code focus the ClawAI view. That is the residual, and it
  is the same nuisance any `vscode://` link already has for every extension
  that registers one; it grants no access and leaves no state.
- If this is judged not worth its surface, deleting the handler and restoring
  the original assertion is a contained change. Nothing else depends on it.

## Alternatives rejected

- **Keep the blanket absence.** Simple, and it forbids two features on the
  strength of a risk that only applies to one of them.
- **Allow a prompt parameter, with a confirmation dialog.** Confirmation is a
  poor defence against a plausible-looking prompt, and the value is small: a
  user who wants to ask something can type it.
- **Sign the deep link.** Solves a problem this surface does not have. Nothing
  passing through it is sensitive, so there is nothing for a signature to
  protect.
