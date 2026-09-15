/** What was captured from one terminal. */
export interface TerminalCapture {
  terminalName: string;
  output: string;
  command?: string;
  exitCode?: number;
}
