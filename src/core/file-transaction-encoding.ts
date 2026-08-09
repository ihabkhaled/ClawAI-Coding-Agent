/**
 * Lets a model send file content that JSON does not have to escape.
 *
 * Writing code means putting source into a JSON string, and every quote, brace
 * and newline in that source has to survive the model's own escaping. It does
 * not: a live mission wrote SQL successfully at 808 bytes and then failed every
 * attempt at a TypeScript file, because the request stopped being parseable
 * JSON before it arrived. The run was told the model "started a tool object and
 * did not finish it", which is true and useless — the model had emitted the
 * right operation and lost it to punctuation.
 *
 * Base64 has no character JSON must escape and no brace or quote to confuse a
 * parser, so `contentBase64` (and the hunk equivalents) removes the whole class
 * of failure rather than trying to repair it after the fact. The decoded value
 * is substituted before the strict transaction schema runs, so nothing
 * downstream knows or cares which form arrived.
 */
const BASE64_PATTERN = /^[A-Za-z0-9+/\s]*={0,2}$/u;

const MAX_ENCODED_LENGTH = 22_369_621;

export function decodeBase64Text(value: string, field: string): string {
  if (value.length > MAX_ENCODED_LENGTH) {
    throw new Error(`${field} exceeds the maximum encoded size`);
  }
  if (!BASE64_PATTERN.test(value)) {
    throw new Error(`${field} is not valid base64`);
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (decoded.length === 0 && value.trim().length > 0) {
    throw new Error(`${field} is not valid base64`);
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replaces a `<field>Base64` key with its decoded `<field>`.
 *
 * Sending both is refused rather than silently preferring one: the two would
 * disagree about what the file should contain, and guessing which the model
 * meant is exactly the kind of quiet rewrite that loses work.
 */
function substitute(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const encodedKey = `${field}Base64`;
  const encoded = record[encodedKey];
  if (encoded === undefined) return record;
  if (typeof encoded !== 'string') throw new Error(`${encodedKey} must be a string`);
  if (record[field] !== undefined) {
    throw new Error(`Send either ${field} or ${encodedKey}, not both`);
  }
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== encodedKey));
  return { ...rest, [field]: decodeBase64Text(encoded, encodedKey) };
}

function normalizeHunk(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return substitute(substitute(value, 'before'), 'after');
}

function normalizeOperation(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const withContent = substitute(value, 'content');
  const hunks = withContent.hunks;
  if (!Array.isArray(hunks)) return withContent;
  return { ...withContent, hunks: hunks.map(normalizeHunk) };
}

/** Decodes every base64 field in a transaction, leaving anything else alone. */
export function normalizeTransactionEncoding(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const operations = value.operations;
  if (!Array.isArray(operations)) return value;
  return { ...value, operations: operations.map(normalizeOperation) };
}
