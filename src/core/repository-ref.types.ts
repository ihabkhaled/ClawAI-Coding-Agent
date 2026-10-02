/** The repository a thread was started in (F095). A reference for matching, never a clone URL. */
export interface RepositoryRef {
  readonly name: string;
  readonly remoteUrl?: string;
  readonly branch?: string;
}

/** What a workspace folder says about its repository, before it is cleaned. */
export interface RepositoryFacts {
  readonly folderName: string;
  readonly remoteUrl: string | undefined;
  readonly branch: string | undefined;
}
