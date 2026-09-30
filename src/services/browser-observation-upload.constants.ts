/**
 * The largest `observe` screenshot handed to the model (F030).
 *
 * A viewport PNG is well under this. The bound keeps one runaway page (a huge
 * device-scale viewport) from becoming a multi-megabyte upload on every turn.
 */
export const MAX_BROWSER_OBSERVATION_UPLOAD_BYTES = 5 * 1024 * 1024;

export const BROWSER_OBSERVATION_MIME_TYPE = 'image/png';
export const BROWSER_OBSERVATION_FILENAME_PREFIX = 'browser-observe-';
export const BROWSER_OBSERVATION_CLIENT_ID_PREFIX = 'browser-observation:';
