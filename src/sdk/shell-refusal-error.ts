import type { ShellRefusal } from './shell-tool.types';

/** The screen's refusal as an error: the message is what the model reads, the rule is what the log keeps. */
export class ShellRefusalError extends Error {
  public readonly rule: string;

  public constructor(refusal: ShellRefusal) {
    super(refusal.message);
    this.name = 'ShellRefusalError';
    this.rule = refusal.rule;
  }
}
