/** Resolves a name to every address it has. */
export type BrowserResolver = (host: string) => Promise<readonly string[]>;

/** The address a connection may go to, or why it may not. */
export type BrowserEgressDecision = { readonly address: string } | { readonly refused: string };

/** What the egress proxy runs with. */
export interface BrowserEgressOptions {
  readonly allowHosts: readonly string[];
  /** Called with a sentence for every connection the policy refused. */
  readonly onRefused: (reason: string) => void;
  readonly resolve?: BrowserResolver | undefined;
}

/** A running egress proxy. */
export interface BrowserEgressProxy {
  /** The proxy address for the browser's `--proxy-server`, `http://127.0.0.1:<port>`. */
  readonly server: string;
  /** Stops listening and drops every open connection. */
  readonly close: () => Promise<void>;
}
