/** What one allow rule admits: a host name, an exact IP, or every subdomain of a name. */
export interface HttpHostRule {
  readonly kind: 'name' | 'ip' | 'wildcard';
  /** Lower case; the suffix without `*.` for a wildcard. */
  readonly host: string;
  /** Absent means the scheme's default port only (80 for http, 443 for https). */
  readonly port?: number | undefined;
}

/** One address a host name resolved to. */
export interface HttpResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Turns a host name into its addresses; injected so tests can simulate DNS. */
export type HttpResolver = (host: string) => Promise<readonly HttpResolvedAddress[]>;

/** A request the model asked for, checked and normalized. */
export interface HttpRequestSpec {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly timeoutMs: number;
  readonly followRedirects: boolean;
  /** Absent: the default for the content type. */
  readonly maxBodyChars: number | undefined;
  readonly expect: HttpStatusExpectation | undefined;
  /** Values to keep from the JSON response: name to path. */
  readonly save: Readonly<Record<string, string>>;
}

/** Secrets the model can spend but not read; see `createVault`. */
export interface HttpVault {
  /** Headers with each {{name}} replaced; throws when the name is unknown or from another origin. */
  expand(headers: Readonly<Record<string, string>>, origin: string): Record<string, string>;
  /** Keeps the wanted values of a JSON body; reports what was kept and what could not be. */
  capture(
    wanted: Readonly<Record<string, string>>,
    body: Buffer,
    origin: string,
  ): { readonly saved: readonly string[]; readonly problems: readonly string[] };
  /** The text with every saved value replaced. */
  scrub(text: string): string;
}

/** What counts as a pass: exact codes and whole classes (`2xx`). */
export interface HttpStatusExpectation {
  readonly codes: readonly number[];
  readonly classes: readonly number[];
}

/** A destination that passed the allowlist: the address to connect to. */
export interface HttpApprovedTarget {
  readonly url: URL;
  readonly address: HttpResolvedAddress;
}

/** What one hop received, before it is formatted. */
export interface HttpHopResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Buffer;
  /** True when the read stopped at the cap. */
  readonly cut: boolean;
}

/** Everything one hop needs. */
export interface HttpHopRequest {
  readonly target: HttpApprovedTarget;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly signal: AbortSignal;
}

/** Sends one hop to an approved address; injected so tests can see what would be sent. */
export type HttpHopSender = (request: HttpHopRequest) => Promise<HttpHopResponse>;

/** Why a request failed on the wire. */
export type HttpFailureCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'CONNECTION_REFUSED'
  | 'DNS_FAILED'
  | 'TLS_VERIFICATION_FAILED'
  | 'CONNECTION_FAILED';

/** What the model reads when the request got no response. */
export interface HttpFailure {
  readonly code: HttpFailureCode;
  readonly message: string;
}

/** The dependencies a tool is built with. */
export interface HttpToolOptions {
  readonly rules: readonly HttpHostRule[];
  readonly resolve?: HttpResolver | undefined;
  readonly send?: HttpHopSender | undefined;
  /** One per tool: the saved values live as long as the run. */
  readonly vault?: HttpVault | undefined;
}

/** The tool as the executor sees it. */
export interface HttpTool {
  execute(args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>;
}
