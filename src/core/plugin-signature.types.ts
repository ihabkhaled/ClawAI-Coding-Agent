import type { PLUGIN_SIGNATURE_POLICIES } from './plugin-signature.constants';

export type PluginSignaturePolicy = (typeof PLUGIN_SIGNATURE_POLICIES)[number];

/** Publisher id to base64 Ed25519 public key (raw 32 bytes or SPKI DER). */
export type TrustedPublishers = Readonly<Record<string, string>>;

/** The four things a signature check can conclude. */
export type SignatureVerdict =
  | { readonly status: 'signed'; readonly signer: string }
  | { readonly status: 'unsigned' }
  | { readonly status: 'unknown-publisher' }
  | { readonly status: 'invalid' };

/** The fields a signature covers; the entry's description is not one of them. */
export interface SignableEntry {
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly source: string;
  readonly sha256: string;
}

/** What to do with a plugin given its verdict and the configured policy. */
export type SignatureOutcome = 'accept' | 'warn' | 'refuse';

/** The policy and trust list one install is judged by. */
export interface PluginSignatureSettings {
  readonly mode: PluginSignaturePolicy;
  readonly trusted: TrustedPublishers;
}
