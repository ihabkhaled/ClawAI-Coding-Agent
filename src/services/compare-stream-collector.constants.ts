/** Events that carry one lane's text or usage; the webview renders them per model, not as progress. */
export const LANE_CONTENT_EVENTS: ReadonlySet<string> = new Set([
  'CONTENT_DELTA',
  'REASONING_DELTA',
  'USAGE',
]);
