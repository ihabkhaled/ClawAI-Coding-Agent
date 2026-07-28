export interface WorkspaceScopeCandidate {
  name: string;
  uri: string;
}

export interface WorkspaceFolderOption {
  key: string;
  name: string;
}

export interface WorkspaceScopeSnapshot {
  folders: WorkspaceFolderOption[];
  selectedFolderKey?: string;
  selectedFolderName?: string;
}
