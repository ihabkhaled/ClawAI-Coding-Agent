export interface ChatMarkupInput {
  cspSource: string;
  language: string;
  nonce: string;
  logoUri: string;
  scriptUri: string;
  styleUri: string;
  translate(message: string): string;
}

/**
 * A translate function whose result is already HTML-escaped. Section renderers
 * receive this instead of the raw translator so no section can forget to escape.
 */
export type ChatMarkupTranslator = (message: string) => string;
