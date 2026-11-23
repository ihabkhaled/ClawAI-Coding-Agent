/** The backend route that turns one audio or video file into text and bills it. */
export const MEDIA_TRANSCRIBE_PATH = '/files/transcribe-text';

/** The tool-result wording that shows the user what a transcription cost them (rule 37). */
export const MEDIA_BILLING_NOTE = 'billed to your credit';

/** The file service's code for "every transcription slot is busy" (HTTP 429, nothing billed). */
export const TRANSCRIBE_BUSY_CODE = 'TRANSCRIBE_READ_BUSY';

/** How often a busy refusal is re-sent before the model is told to try later. */
export const TRANSCRIBE_BUSY_RETRIES = 2;

/** The wait before re-sending a busy refusal; the backend sends no Retry-After. */
export const TRANSCRIBE_BUSY_WAIT_MS = 3_000;
