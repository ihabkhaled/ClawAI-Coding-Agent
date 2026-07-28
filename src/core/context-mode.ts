export type ContextMode = 'file' | 'none' | 'selection' | 'smart' | 'workspace';

export interface WorkspaceReadiness {
  hasActiveFile: boolean;
  hasSelection: boolean;
  hasWorkspace: boolean;
  trusted: boolean;
  workspaceName?: string;
}

export function resolveSmartContext(readiness: WorkspaceReadiness): Exclude<ContextMode, 'smart'> {
  if (readiness.hasSelection) {
    return 'selection';
  }
  if (readiness.hasActiveFile) {
    return 'file';
  }
  if (readiness.hasWorkspace && readiness.trusted) {
    return 'workspace';
  }
  return 'none';
}
