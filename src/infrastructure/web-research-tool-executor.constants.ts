/**
 * How much of a fetched page may travel in one tool result.
 *
 * The Runtime V2 JSON contract caps any single string at
 * `MAX_RUNTIME_JSON_STRING_LENGTH`. A page longer than that produced a
 * structurally invalid result: the backend refused the tool result with
 * `400 Validation failed` and the run died with nothing naming the field. The
 * filesystem read was fixed for exactly this and the web fetch was not, so a
 * long documentation page — the kind an agent is most likely to be sent to —
 * killed the run that fetched it.
 *
 * The margin leaves room for the rest of the structured payload, which travels
 * in the same envelope.
 */
export const WEB_FETCH_CONTENT_MARGIN_CHARACTERS = 2_048;

/** What the model is told when a page was cut, so it can ask for the rest. */
export const WEB_FETCH_TRUNCATION_NOTICE =
  '\n\n[The page was longer than one tool result allows and was cut here. Fetch a more specific URL, or search for the part you need.]';
