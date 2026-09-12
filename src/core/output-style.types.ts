/** The name of a response style, built in or defined by the workspace. */
export type OutputStyle = string;

/** A style and the instruction it prepends to a prompt. */
export interface OutputStyleDefinition {
  name: OutputStyle;
  preamble: string;
}
