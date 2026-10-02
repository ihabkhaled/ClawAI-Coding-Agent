import {
  JOB_SECRET_FORBIDDEN_NAMES,
  JOB_SECRET_FORBIDDEN_PREFIXES,
  JOB_SECRET_MAX_COUNT,
  JOB_SECRET_MAX_VALUE_BYTES,
  JOB_SECRET_MIN_REDACTED_LENGTH,
  JOB_SECRET_NAME_PATTERN,
  JOB_SECRET_REDACTION,
} from './job-secrets.constants';

import type { JobSecretEntry, JobSecretEnvironment } from './job-secrets.types';

function nameAllowed(name: string): boolean {
  return (
    JOB_SECRET_NAME_PATTERN.test(name) &&
    !JOB_SECRET_FORBIDDEN_NAMES.has(name) &&
    !JOB_SECRET_FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function valueAllowed(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= JOB_SECRET_MAX_VALUE_BYTES
  );
}

/**
 * The environment map for one job. An entry the server should never have sent
 * (a name that would change how code loads, a NUL in a value, too many) is
 * dropped silently: the job still runs, without it, and nothing is echoed.
 */
export function jobSecretEnvironment(
  entries: readonly JobSecretEntry[] | undefined,
): JobSecretEnvironment {
  const environment: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (Object.keys(environment).length >= JOB_SECRET_MAX_COUNT) break;
    if (nameAllowed(entry.name) && valueAllowed(entry.value)) environment[entry.name] = entry.value;
  }
  return environment;
}

/** The value, and the two re-encodings a command most often prints it in. */
function encodedForms(value: string): string[] {
  return [value, Buffer.from(value, 'utf8').toString('base64'), encodeURIComponent(value)];
}

/** Replaces every exact occurrence of a secret value, longest first. */
export function redactJobSecrets(text: string, environment: JobSecretEnvironment): string {
  const values = [...new Set(Object.values(environment).flatMap(encodedForms))]
    .filter((value) => value.length >= JOB_SECRET_MIN_REDACTED_LENGTH)
    .sort((left, right) => right.length - left.length);
  let result = text;
  for (const value of values) result = result.split(value).join(JOB_SECRET_REDACTION);
  return result;
}

/** Walks a tool result and scrubs every string in it. */
export function redactJobSecretsDeep(value: unknown, environment: JobSecretEnvironment): unknown {
  if (Object.keys(environment).length === 0) return value;
  if (typeof value === 'string') return redactJobSecrets(value, environment);
  if (Array.isArray(value)) return value.map((entry) => redactJobSecretsDeep(entry, environment));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactJobSecretsDeep(entry, environment)]),
    );
  }
  return value;
}
