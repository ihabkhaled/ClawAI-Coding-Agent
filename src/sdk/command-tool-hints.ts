import { COMMAND_NO_SHELL_HINT, COMMAND_SHELL_TOKEN_PATTERN } from './command-tool.constants';

/** The allowlist with repeats removed, in the order first given (names compare without case). */
export function distinctExecutables(allowed: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return allowed.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The refusal for a program that is not on the allowlist, with what to do instead. */
export function disallowedCommandMessage(executable: string, allowed: readonly string[]): string {
  return `Command ${executable} is not allowed. Allowed: ${distinctExecutables(allowed).join(', ')}. ${COMMAND_NO_SHELL_HINT}`;
}

/** The first argument that is shell syntax on its own (a pipe, a redirect, `&&`, `;`), if any. */
export function shellSyntaxArgument(args: readonly string[]): string | undefined {
  return args.find((argument) => COMMAND_SHELL_TOKEN_PATTERN.test(argument.trim()));
}

/** The refusal for shell syntax passed as an argument; nothing has run. */
export function shellSyntaxMessage(token: string): string {
  return `The argument "${token}" is shell syntax and would be passed to the program as text. ${COMMAND_NO_SHELL_HINT}`;
}
