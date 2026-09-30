/** Largest error body read back from the backend before it is truncated. */
export const MAX_ERROR_BODY_BYTES = 64_000;
/** Largest successful response body the client will parse. */
export const MAX_SUCCESS_BODY_BYTES = 8_000_000;
/** What a body that is not JSON, or not the expected shape, is reported as. */
export const UNREADABLE_RESPONSE_MESSAGE = 'ClawAI returned a response this version cannot read.';
