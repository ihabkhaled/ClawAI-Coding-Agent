/** The `run.failed` payload fields that can say why, in the order they are read. */
export const FAILURE_REASON_FIELDS: readonly string[] = [
  'code',
  'message',
  'error',
  'reason',
  'detail',
];

/** The longest failure reason kept. */
export const FAILURE_REASON_MAX_CHARS = 400;
