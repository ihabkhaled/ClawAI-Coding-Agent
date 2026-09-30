export function createWorkspace(files?: Record<string, string>): string;
export function toolExecutor(
  workspace: string,
): (toolName: string, operation: string, args: Record<string, unknown>, token?: string) => unknown;
