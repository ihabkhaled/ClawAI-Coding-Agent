# Persisted message model labels

## Goal

Show the model associated with every user and assistant message, including after
the conversation is reopened. A model selection captured for one request must
not change when the composer selection changes later.

## Chosen approach

Use the chat service's existing canonical persistence fields rather than an
extension-only cache or a new database column. User messages already support a
bounded `metadata.modelDisplayName` value; assistant messages already persist
their resolved `provider` and `model` values. The extension will validate and
forward that metadata when loading history.

For live requests, the webview snapshots the selected model label before it
submits the request. Both the user card and its paired assistant card display
that snapshot immediately. When the backend reports the resolved provider and
model, the assistant card switches to the authoritative resolved identity. If a
request fails before provider selection, the submitted label remains visible.

Automatic routing is displayed as `Automatic routing` on the user card and
until a concrete assistant model is reported. Compare requests display the
selected model labels as a compact joined label on the prompt and retain the
existing per-response provider/model cards.

## Presentation

Model identity is a compact, theme-aware metadata chip beside token usage in
the existing message header. It uses text-only DOM construction, logical CSS
properties for RTL, truncation with a title for long model names, forced-color
compatible borders, and no additional animation.

## Data flow

1. The composer resolves model keys to display labels at submission time.
2. The user and pending assistant cards receive the immutable submitted label.
3. The extension sends `modelDisplayName` on legacy chat message creation.
4. Stream/result provenance replaces only the assistant card's provisional
   label when the backend reports a concrete provider/model.
5. History loading validates `metadata.modelDisplayName` and renders it on user
   messages; assistant history uses persisted provider/model.

Runtime V2 keeps the same live-card behavior. Its persisted messages remain
authoritative when history is reloaded.

## Failure handling

Missing or malformed historical metadata is ignored. Existing conversations
remain readable and simply omit labels that were never stored. Errors preserve
the submitted model label instead of replacing the entire metadata area with
only `Error`.

## Tests

- Unit tests cover model display-name propagation into chat submissions and
  validated history mapping.
- Playwright tests verify both live cards, resolved assistant replacement,
  failed-request retention, and reopened historical messages.
- The existing Runtime V2 persisted-thread regression remains in the same
  release and is validated independently.
