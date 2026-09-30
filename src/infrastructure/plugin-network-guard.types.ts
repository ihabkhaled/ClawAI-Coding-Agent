/** Resolves a host name to every address it maps to. */
export type HostLookup = (host: string) => Promise<readonly string[]>;

export interface PluginNetworkOptions {
  /** Intranet marketplaces: the user has opted into private sources. */
  readonly allowPrivate?: boolean;
  /** Port for DNS, so tests never touch the network. */
  readonly lookup?: HostLookup;
}
