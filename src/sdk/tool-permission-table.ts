import { TOOL_PERMISSION_ROWS } from './tool-permission-table.constants';

import type { ToolPermissionRow } from './tool-permission-table.types';
import type { AgentApprovalRequest } from './workspace-toolkit.types';

const key = (tool: string, operation: string, category: string): string =>
  `${tool}\u0000${operation}\u0000${category}`;

const ROWS_BY_CALL: ReadonlyMap<string, ToolPermissionRow> = new Map(
  TOOL_PERMISSION_ROWS.map((row) => [key(row.tool, row.operation, row.category), row]),
);

/** The row that decides this call, or undefined for a tool the table does not cover. */
export function toolPermissionRow(request: AgentApprovalRequest): ToolPermissionRow | undefined {
  return ROWS_BY_CALL.get(key(request.toolName, request.operation, request.category));
}
