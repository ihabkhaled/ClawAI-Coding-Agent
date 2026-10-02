import { HttpRefusal } from './http-tool-target';
import {
  HTTP_REDACTED,
  HTTP_VAULT_MAX_ENTRIES,
  HTTP_VAULT_MAX_VALUE_CHARS,
  HTTP_VAULT_MIN_VALUE_CHARS,
  HTTP_VAULT_NAME_PATTERN,
  HTTP_VAULT_PLACEHOLDER,
} from './http-tool.constants';

import type { HttpVault } from './http-tool.types';

/** One step of a path like `data.items[0].token`. */
function steps(path: string): readonly (string | number)[] {
  return [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/gu)].map((match) =>
    match[2] === undefined ? (match[1] ?? '') : Number(match[2]),
  );
}

function valueAt(json: unknown, path: string): unknown {
  let current: unknown = json;
  for (const step of steps(path)) {
    if (typeof current !== 'object' || current === null) return undefined;
    current =
      typeof step === 'number' && Array.isArray(current)
        ? current[step]
        : (current as Record<string, unknown>)[String(step)];
  }
  return current;
}

/** Paths of the string values worth saving, so a wrong guess can be answered with the right names. */
function stringPaths(json: unknown, prefix = '', depth = 0): string[] {
  if (typeof json === 'string') {
    return json.length >= HTTP_VAULT_MIN_VALUE_CHARS && prefix.length > 0 ? [prefix] : [];
  }
  if (typeof json !== 'object' || json === null || depth >= 3) return [];
  const entriesOf: [string, unknown][] = Array.isArray(json)
    ? json.slice(0, 3).map((item: unknown, index) => [`[${String(index)}]`, item])
    : Object.entries(json);
  return entriesOf.flatMap(([key, value]) =>
    stringPaths(
      value,
      prefix === '' || key.startsWith('[') ? `${prefix}${key}` : `${prefix}.${key}`,
      depth + 1,
    ),
  );
}

function parsedJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Values the model may use but never read.
 *
 * A login returns a token the model needs for the next call and must not see:
 * `save` keeps it here, a `{{name}}` in a request header spends it, and the
 * value is scrubbed from every result. A value is spent only at the origin
 * that issued it, so a page that talks the model into calling another allowed
 * host cannot carry the token there. It lives as long as the tool: one run.
 */
export function createVault(): HttpVault {
  const entries = new Map<string, { value: string; origin: string }>();
  return {
    expand: (headers, origin) => {
      const out: Record<string, string> = {};
      for (const [name, text] of Object.entries(headers)) {
        out[name] = text.replace(HTTP_VAULT_PLACEHOLDER, (_whole, key: string) => {
          const entry = entries.get(key);
          if (entry === undefined) {
            throw new HttpRefusal(
              `No saved value named "${key}". Save one with save: {"${key}": "path.in.json"} on the request that returns it.`,
            );
          }
          if (entry.origin !== origin) {
            throw new HttpRefusal(
              `"${key}" was saved from ${entry.origin} and is only sent there.`,
            );
          }
          return entry.value;
        });
      }
      return out;
    },
    capture: (wanted, body, origin) => {
      const saved: string[] = [];
      const problems: string[] = [];
      const json = Object.keys(wanted).length === 0 ? undefined : parsedJson(body);
      for (const [name, path] of Object.entries(wanted)) {
        const value: unknown = valueAt(json, path);
        const text = typeof value === 'number' ? String(value) : value;
        if (
          typeof text !== 'string' ||
          text.length < HTTP_VAULT_MIN_VALUE_CHARS ||
          text.length > HTTP_VAULT_MAX_VALUE_CHARS ||
          (!entries.has(name) && entries.size >= HTTP_VAULT_MAX_ENTRIES)
        ) {
          const known = stringPaths(json).slice(0, 12);
          const hint =
            known.length === 0
              ? 'the body has no JSON strings'
              : `string fields: ${known.join(', ')}`;
          problems.push(`${name}: no usable string at "${path}" (${hint})`);
        } else {
          entries.set(name, { value: text, origin });
          saved.push(name);
        }
      }
      return { saved, problems };
    },
    scrub: (text) => {
      let out = text;
      for (const { value } of entries.values()) out = out.split(value).join(HTTP_REDACTED);
      return out;
    },
  };
}

/** Whether a name can be saved under. */
export function validVaultName(name: string): boolean {
  return HTTP_VAULT_NAME_PATTERN.test(name);
}
