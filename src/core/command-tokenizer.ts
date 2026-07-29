export function tokenizeWorkspaceCommand(command: string): string[] | undefined {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (const character of command) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }

  if (quote !== undefined) {
    return undefined;
  }
  if (current !== '') {
    tokens.push(current);
  }
  return tokens;
}
