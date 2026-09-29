export type RemoteCommandParse =
  | { readonly kind: 'ok'; readonly executable: string; readonly args: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string };

/** R0/R1 may run unattended; R2 and above always need local approval. */
export type RemoteCommandRisk = 'R1' | 'R2';
