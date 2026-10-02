/** Splits a command line like a shell would for the simple quoting the docs use. */
export function cliWords(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/gu)].map((match) =>
    (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/gu, '$1'),
  );
}
