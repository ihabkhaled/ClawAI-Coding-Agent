export * from '../core/retry-classifier.constants';

/** The code the runtime's stream reports when its state store is briefly away. */
export const STREAM_UNAVAILABLE_CODE = 'RUNTIME_STATE_UNAVAILABLE';

/** The frame the runtime sends when the stream itself fails. */
export const STREAM_ERROR_EVENT_TYPE = 'stream.error';
