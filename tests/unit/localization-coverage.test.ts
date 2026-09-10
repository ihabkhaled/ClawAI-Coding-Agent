import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const LOCALES = ['ar', 'de', 'es', 'fa', 'fr', 'hi', 'it', 'ja', 'pt', 'ru', 'th', 'zh'] as const;

function bundle(locale?: string): Record<string, string> {
  const suffix = locale === undefined ? '' : `.${locale}`;
  return JSON.parse(readFileSync(`l10n/bundle.l10n${suffix}.json`, 'utf8')) as Record<
    string,
    string
  >;
}

const english = bundle();
const bundles = new Map(LOCALES.map((locale) => [locale, bundle(locale)]));
const baseline = new Set(
  JSON.parse(readFileSync('l10n/untranslated-baseline.json', 'utf8')) as string[],
);

/**
 * A message is untranslated when at least one locale gives back the English
 * source. The generator falls through to the source for any string it has no
 * entry for, so a bundle is always complete and never says which entries are
 * real — identity is the only signal there is.
 *
 * Some short strings are legitimately identical in some languages. Those go in
 * the baseline like any other entry rather than being guessed at here: a rule
 * that tried to tell a real match from a fallback would be wrong quietly.
 */
function untranslated(): string[] {
  return Object.keys(english).filter((message) =>
    LOCALES.some((locale) => bundles.get(locale)?.[message] === message),
  );
}

describe('localization coverage', () => {
  it('translates every message added after the baseline was taken', () => {
    const regressions = untranslated().filter((message) => !baseline.has(message));

    expect(regressions).toEqual([]);
  });

  it('keeps the baseline honest by refusing entries that are now translated', () => {
    const stale = [...baseline].filter(
      (message) => message in english && !untranslated().includes(message),
    );

    expect(stale).toEqual([]);
  });

  it('drops baseline entries for messages that no longer exist', () => {
    expect([...baseline].filter((message) => !(message in english))).toEqual([]);
  });

  it('ships every locale the manifest claims', () => {
    expect([...bundles.keys()]).toHaveLength(LOCALES.length);
  });
});
