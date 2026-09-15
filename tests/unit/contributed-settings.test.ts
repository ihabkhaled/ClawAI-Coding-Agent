import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SETTING_PREFIX = 'clawAI.';

interface SettingSchema {
  readonly type?: string | string[];
  readonly default?: unknown;
  readonly enum?: unknown[];
  readonly description?: string;
  readonly markdownDescription?: string;
  readonly scope?: string;
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { configuration: { properties: Record<string, SettingSchema> } };
};
const settings = Object.entries(manifest.contributes.configuration.properties);
const sources = readFileSync('src/services/configuration-service.ts', 'utf8');

/**
 * Every contributed setting, checked against the manifest rather than a list
 * somebody keeps up to date.
 *
 * A setting is a promise to a user: it appears in their settings UI, it claims a
 * type, and it claims a default. None of that was tested. A setting whose
 * default contradicts its own type, or which nothing reads, is a control that
 * does nothing — and the user has no way to discover that except by trying it.
 */
describe('contributed settings', () => {
  it('contributes at least the settings the package audit counts', () => {
    expect(settings.length).toBeGreaterThanOrEqual(24);
  });

  it('names every setting under the extension prefix', () => {
    for (const [key] of settings) expect(key.startsWith(SETTING_PREFIX)).toBe(true);
  });

  it('gives every setting a description a user can read', () => {
    for (const [key, schema] of settings) {
      const described = schema.description ?? schema.markdownDescription ?? '';
      expect(described.length, `${key} has no description`).toBeGreaterThan(10);
    }
  });

  it('gives every setting a default, so none starts undefined', () => {
    for (const [key, schema] of settings) {
      expect(schema, `${key} has no default`).toHaveProperty('default');
    }
  });

  it('gives every default a value its own declared type allows', () => {
    for (const [key, schema] of settings) {
      const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = Array.isArray(schema.default) ? 'array' : typeof schema.default;
      const allowed =
        declared.includes(actual) || (schema.default === null && declared.includes('null'));

      expect(allowed, `${key} declares ${String(schema.type)} and defaults to ${actual}`).toBe(
        true,
      );
    }
  });

  it('keeps every enumerated default inside its own enum', () => {
    for (const [key, schema] of settings) {
      if (schema.enum === undefined) continue;
      expect(schema.enum, `${key} default is outside its enum`).toContain(schema.default);
    }
  });

  it('is read by the configuration service, so no setting is decorative', () => {
    // Rule 1: a setting nothing reads is dormant. The service reads by suffix,
    // which is why the prefix is stripped before looking.
    const unread = settings
      .map(([key]) => key.replace(SETTING_PREFIX, ''))
      .filter((suffix) => !sources.includes(`'${suffix}'`));

    expect(unread, `settings nothing reads: ${unread.join(', ')}`).toEqual([]);
  });

  it('declares a numeric bound wherever it accepts a number', () => {
    for (const [key, schema] of settings) {
      const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!declared.includes('number') && !declared.includes('integer')) continue;
      const bounded = schema as { minimum?: number; maximum?: number };

      expect(
        bounded.minimum !== undefined || bounded.maximum !== undefined,
        `${key} accepts a number with no bound`,
      ).toBe(true);
    }
  });
});
