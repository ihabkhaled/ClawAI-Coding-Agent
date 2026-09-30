import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES = ['ar', 'de', 'es', 'fa', 'fr', 'hi', 'it', 'ja', 'pt', 'ru', 'th', 'zh'] as const;
const PLACEHOLDER = /\{\d+\}/g;

function read(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

function bundle(locale?: string): Record<string, string> {
  const suffix = locale === undefined ? '' : `.${locale}`;
  return { ...read(`l10n/bundle.l10n${suffix}.json`), ...read(`package.nls${suffix}.json`) };
}

/** Placeholders sorted, so `{1} {0}` in a translation still matches `{0} {1}`. */
function placeholders(text: string): string {
  return (text.match(PLACEHOLDER) ?? []).sort().join(',');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Exact English strings passed as the first argument of `vscode.l10n.t(...)`. */
function callSiteMessages(): { file: string; message: string }[] {
  const quoted = (quote: string): string => `${quote}((?:[^${quote}\\\\]|\\\\.)*)${quote}`;
  const call = new RegExp(`l10n\\.t\\(\\s*(?:${quoted("'")}|${quoted('"')}|${quoted('`')})`, 'g');
  return sourceFiles('src').flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(call)].map((match) => ({
      file,
      message: (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(['"n])/g, (_all, ch: string) =>
        ch === 'n' ? '\n' : ch,
      ),
    })),
  );
}

const english = bundle();

describe('localization quality', () => {
  it.each(LOCALES)('%s carries every message with the same placeholders', (locale) => {
    const translated = bundle(locale);
    const broken = Object.keys(english).filter((key) => {
      const value = translated[key];
      return value === undefined || placeholders(value) !== placeholders(english[key] ?? key);
    });

    expect(broken).toEqual([]);
  });

  it('finds every vscode.l10n.t call site in the runtime bundle', () => {
    expect(callSiteMessages().length).toBeGreaterThan(100);
    const missing = callSiteMessages()
      .filter(({ message }) => !(message in english))
      .map(({ file, message }) => `${file}: ${message}`);

    expect(missing).toEqual([]);
  });
});
